use std::time::Duration;

use anyhow::{Context, Result};
use futures_util::{StreamExt, stream};
use redis::{
    AsyncCommands,
    aio::MultiplexedConnection,
    streams::{StreamInfoGroupsReply, StreamReadOptions, StreamReadReply},
};
use tokio::time::sleep;
use tracing::{error, info, warn};

use crate::{
    config::{GatewayConfig, GatewayRealtimeRolloutStage},
    control_plane::{FailureClass, LifecyclePhase, LifecycleStatus, MarkUnitInput, RecoveryAction},
    ingress_commands::normalize_ingress_command,
    realtime::ingress::auth::detect_auth_failure_class,
    realtime_contracts::{RealtimeDropReason, RealtimeEventEnvelopeV1, RealtimeTopic},
    state::AppState,
};

const STREAM_BLOCK_MS: usize = 2_000;
const STREAM_READ_COUNT: usize = 64;
const STREAM_PROCESS_CONCURRENCY: usize = 16;

pub fn spawn_realtime_consumer_loop(state: AppState) {
    tokio::spawn(async move {
        loop {
            if let Err(err) = run_consumer(state.clone()).await {
                record_stream_failure(&state, format!("realtime stream consumer error: {err}"));
                error!(error = %err, "realtime stream consumer exited");
                sleep(Duration::from_secs(2)).await;
                continue;
            }
            break;
        }
    });
}

async fn run_consumer(state: AppState) -> Result<()> {
    let client = redis::Client::open(state.config.realtime_redis_url.clone())
        .context("open realtime redis client")?;
    let mut connection = client
        .get_multiplexed_async_connection()
        .await
        .context("connect realtime redis")?;

    ensure_group(&mut connection, &state.config).await?;
    record_stream_ready(&state, "realtime stream boundary connected".to_string());

    loop {
        let reply: Option<StreamReadReply> = connection
            .xread_options(
                &[state.config.realtime_stream_key.as_str()],
                &[">"],
                &StreamReadOptions::default()
                    .block(STREAM_BLOCK_MS)
                    .count(STREAM_READ_COUNT)
                    .group(
                        state.config.realtime_consumer_group.as_str(),
                        state.config.realtime_consumer_name.as_str(),
                    ),
            )
            .await
            .context("xread realtime ingress stream")?;

        update_stream_lag(&mut connection, &state).await;

        let Some(reply) = reply else {
            continue;
        };

        for key in reply.keys {
            let results = process_stream_batch(&key.ids).await;
            finalize_stream_batch(&state, &mut connection, &results).await;
        }
    }
}

async fn decode_stream_message(
    fields: &std::collections::HashMap<String, redis::Value>,
) -> Result<RealtimeEventEnvelopeV1> {
    let raw_event = fields
        .get("event")
        .and_then(value_to_string)
        .context("missing realtime event payload")?;
    let envelope = RealtimeEventEnvelopeV1::decode(&raw_event)?;
    Ok(envelope)
}

#[derive(Debug)]
struct StreamMessageOutcome {
    message_id: String,
    raw_event: Option<String>,
    envelope: Result<RealtimeEventEnvelopeV1>,
}

#[derive(Debug, Clone)]
struct OwnedStreamMessage {
    message_id: String,
    raw_event: Option<String>,
    fields: std::collections::HashMap<String, redis::Value>,
}

async fn process_stream_batch(messages: &[redis::streams::StreamId]) -> Vec<StreamMessageOutcome> {
    let owned_messages = messages
        .iter()
        .map(|message| OwnedStreamMessage {
            message_id: message.id.clone(),
            raw_event: message.map.get("event").and_then(value_to_string),
            fields: message.map.clone(),
        })
        .collect::<Vec<_>>();

    stream::iter(owned_messages)
        .map(|message| async move {
            let envelope = decode_stream_message(&message.fields).await;
            StreamMessageOutcome {
                message_id: message.message_id,
                raw_event: message.raw_event,
                envelope,
            }
        })
        .buffered(STREAM_PROCESS_CONCURRENCY)
        .collect()
        .await
}

async fn finalize_stream_batch(
    state: &AppState,
    connection: &mut MultiplexedConnection,
    outcomes: &[StreamMessageOutcome],
) {
    let ack_ids = collect_ack_ids(outcomes);

    for outcome in outcomes {
        match &outcome.envelope {
            Ok(envelope) => apply_ingress_envelope(state, envelope).await,
            Err(err) => {
                record_drop_reason(state, RealtimeDropReason::InvalidEvent);
                let _ = write_dlq(
                    connection,
                    &state.config,
                    "realtime_ingress",
                    outcome.raw_event.clone(),
                    err.to_string(),
                )
                .await;
                warn!(message_id = %outcome.message_id, error = %err, "realtime ingress message rejected");
            }
        }
    }

    ack_stream_batch(
        connection,
        state.config.realtime_stream_key.as_str(),
        state.config.realtime_consumer_group.as_str(),
        &ack_ids,
    )
    .await;
}

fn collect_ack_ids<'a>(outcomes: &'a [StreamMessageOutcome]) -> Vec<&'a str> {
    outcomes
        .iter()
        .map(|outcome| outcome.message_id.as_str())
        .collect()
}

async fn ack_stream_batch(
    connection: &mut MultiplexedConnection,
    stream: &str,
    group: &str,
    message_ids: &[&str],
) {
    if message_ids.is_empty() {
        return;
    }

    let _: usize = connection
        .xack(stream, group, message_ids)
        .await
        .unwrap_or(0);
}

pub async fn apply_ingress_envelope(state: &AppState, envelope: &RealtimeEventEnvelopeV1) {
    {
        let mut ops = state
            .realtime_ops
            .lock()
            .expect("realtime ops mutex poisoned");
        ops.record_envelope(envelope);
        if let Some(auth_failure_class) = detect_auth_failure_class(envelope) {
            ops.record_auth_failure(&auth_failure_class);
        }
    }

    {
        match envelope.topic {
            RealtimeTopic::SessionOpened => {
                state.session_registry.apply_session_opened(envelope).await
            }
            RealtimeTopic::SessionClosed => {
                state.session_registry.apply_session_closed(envelope).await
            }
            RealtimeTopic::SessionHeartbeat => {
                state
                    .session_registry
                    .apply_session_heartbeat(envelope)
                    .await
            }
            _ => {}
        }

        let snapshot = state.session_registry.snapshot(120).await;
        let mut bridge = state
            .realtime_fanout_bridge
            .lock()
            .expect("realtime fanout bridge mutex poisoned");
        bridge.refresh_registry(
            snapshot.users.len(),
            snapshot.totals.room_subscriptions,
            envelope.emitted_at.clone(),
        );
    }

    if matches!(envelope.topic, RealtimeTopic::PresenceUpdated) {
        let mut presence = state
            .realtime_presence
            .lock()
            .expect("realtime presence mutex poisoned");
        presence.apply_presence_update(envelope);
    }

    if let Some(command) = normalize_ingress_command(envelope) {
        info!(
            topic = ?envelope.topic,
            session_id = %command.session_id,
            user_id = ?command.user_id,
            chat_id = ?command.chat_id,
            "normalized realtime ingress command"
        );
    }
}

async fn ensure_group(
    connection: &mut MultiplexedConnection,
    config: &GatewayConfig,
) -> Result<()> {
    let result: redis::RedisResult<()> = connection
        .xgroup_create_mkstream(
            config.realtime_stream_key.as_str(),
            config.realtime_consumer_group.as_str(),
            "0",
        )
        .await;
    match result {
        Ok(_) => Ok(()),
        Err(err) if err.to_string().contains("BUSYGROUP") => Ok(()),
        Err(err) => Err(err).context("create realtime consumer group"),
    }
}

async fn update_stream_lag(connection: &mut MultiplexedConnection, state: &AppState) {
    let reply: redis::RedisResult<StreamInfoGroupsReply> = connection
        .xinfo_groups(state.config.realtime_stream_key.as_str())
        .await;
    match reply {
        Ok(groups) => {
            let lag = groups
                .groups
                .into_iter()
                .find(|group| group.name == state.config.realtime_consumer_group)
                .and_then(|group| group.lag.map(|value| value as u64));
            let mut ops = state
                .realtime_ops
                .lock()
                .expect("realtime ops mutex poisoned");
            ops.set_ingress_stream_lag(lag);
        }
        Err(err) => {
            record_drop_reason(state, RealtimeDropReason::StreamReadFailed);
            warn!(error = %err, "failed to update realtime ingress lag");
        }
    }
}

async fn write_dlq(
    connection: &mut MultiplexedConnection,
    config: &GatewayConfig,
    kind: &str,
    raw_event: Option<String>,
    reason: String,
) -> Result<()> {
    redis::cmd("XADD")
        .arg(config.realtime_dlq_stream_key.as_str())
        .arg("MAXLEN")
        .arg("~")
        .arg(5000)
        .arg("*")
        .arg("kind")
        .arg(kind)
        .arg("reason")
        .arg(reason)
        .arg("event")
        .arg(raw_event.unwrap_or_else(|| "{}".to_string()))
        .query_async::<()>(connection)
        .await
        .context("write realtime dlq entry")
}

fn record_stream_ready(state: &AppState, message: String) {
    let compat_mode = !matches!(
        state.config.realtime_rollout_stage,
        GatewayRealtimeRolloutStage::RustEdgePrimary
    );
    let mut plane = state
        .control_plane
        .lock()
        .expect("control plane mutex poisoned");
    plane.mark_unit(MarkUnitInput {
        unit: "realtime_stream_boundary",
        phase: LifecyclePhase::Runtime,
        status: LifecycleStatus::Running,
        critical: Some(false),
        compat_mode: Some(compat_mode),
        retries: None,
        recovery_action: Some(RecoveryAction::DegradeToCompat),
        failure_class: None,
        message: Some(message),
    });
}

fn record_stream_failure(state: &AppState, message: String) {
    let compat_mode = !matches!(
        state.config.realtime_rollout_stage,
        GatewayRealtimeRolloutStage::RustEdgePrimary
    );
    let mut plane = state
        .control_plane
        .lock()
        .expect("control plane mutex poisoned");
    plane.mark_failure(crate::control_plane::FailureInput {
        unit: "realtime_stream_boundary",
        phase: LifecyclePhase::Runtime,
        failure_class: FailureClass::DependencyRuntime,
        message,
        critical: Some(false),
        recovery_action: Some(RecoveryAction::DegradeToCompat),
        compat_mode,
        increment_retry: true,
    });
}

fn record_drop_reason(state: &AppState, reason: RealtimeDropReason) {
    let mut ops = state
        .realtime_ops
        .lock()
        .expect("realtime ops mutex poisoned");
    ops.record_ingress_drop_reason(reason);
}

fn value_to_string(value: &redis::Value) -> Option<String> {
    redis::from_redis_value::<String>(value).ok()
}

#[cfg(test)]
mod tests {
    use super::{StreamMessageOutcome, collect_ack_ids};
    use anyhow::anyhow;

    #[test]
    fn collect_ack_ids_keeps_stream_batch_order() {
        let outcomes = vec![
            StreamMessageOutcome {
                message_id: "1-0".to_string(),
                raw_event: Some("{}".to_string()),
                envelope: Err(anyhow!("not used")),
            },
            StreamMessageOutcome {
                message_id: "2-0".to_string(),
                raw_event: Some("{}".to_string()),
                envelope: Err(anyhow!("decode failure")),
            },
            StreamMessageOutcome {
                message_id: "3-0".to_string(),
                raw_event: Some("{}".to_string()),
                envelope: Err(anyhow!("not used")),
            },
        ];

        assert_eq!(collect_ack_ids(&outcomes), vec!["1-0", "2-0", "3-0"]);
    }
}
