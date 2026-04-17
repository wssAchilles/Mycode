use std::time::Duration;

use anyhow::{Context, Result};
use redis::{
    AsyncCommands,
    aio::MultiplexedConnection,
    streams::{StreamInfoGroupsReply, StreamReadOptions, StreamReadReply},
};
use tokio::time::sleep;
use tracing::{error, warn};

use crate::{
    config::{GatewayConfig, GatewayRealtimeRolloutStage},
    control_plane::{FailureClass, LifecyclePhase, LifecycleStatus, MarkUnitInput, RecoveryAction},
    realtime::transport::compat_dispatch::publish_compat_dispatch,
    realtime_contracts::{RealtimeDeliveryEnvelopeV1, RealtimeDropReason},
    state::AppState,
};

const STREAM_BLOCK_MS: usize = 2_000;
const STREAM_READ_COUNT: usize = 64;

pub fn spawn_delivery_consumer_loop(state: AppState) {
    tokio::spawn(async move {
        loop {
            if let Err(err) = run_consumer(state.clone()).await {
                record_stream_failure(&state, format!("realtime delivery consumer error: {err}"));
                error!(error = %err, "realtime delivery consumer exited");
                sleep(Duration::from_secs(2)).await;
                continue;
            }
            break;
        }
    });
}

async fn run_consumer(state: AppState) -> Result<()> {
    let client = redis::Client::open(state.config.realtime_redis_url.clone())
        .context("open realtime delivery redis client")?;
    let mut connection = client
        .get_multiplexed_async_connection()
        .await
        .context("connect realtime delivery redis")?;

    ensure_group(&mut connection, &state.config).await?;
    record_stream_ready(&state, "realtime delivery boundary connected".to_string());

    loop {
        let reply: Option<StreamReadReply> = connection
            .xread_options(
                &[state.config.realtime_delivery_stream_key.as_str()],
                &[">"],
                &StreamReadOptions::default()
                    .block(STREAM_BLOCK_MS)
                    .count(STREAM_READ_COUNT)
                    .group(
                        state.config.realtime_delivery_consumer_group.as_str(),
                        state.config.realtime_delivery_consumer_name.as_str(),
                    ),
            )
            .await
            .context("xread realtime delivery stream")?;

        update_stream_lag(&mut connection, &state).await;

        let Some(reply) = reply else {
            continue;
        };

        for key in reply.keys {
            for message in key.ids {
                let processing =
                    process_stream_message(&state, &mut connection, &message.id, &message.map).await;
                if let Err(err) = processing {
                    record_drop_reason(&state, RealtimeDropReason::DeliveryInvalidEvent);
                    let _ = write_dlq(
                        &mut connection,
                        &state.config,
                        "realtime_delivery",
                        message
                            .map
                            .get("delivery")
                            .and_then(value_to_string)
                            .or_else(|| message.map.get("event").and_then(value_to_string)),
                        err.to_string(),
                    )
                    .await;
                    let _: usize = connection
                        .xack(
                            state.config.realtime_delivery_stream_key.as_str(),
                            state.config.realtime_delivery_consumer_group.as_str(),
                            &[message.id.as_str()],
                        )
                        .await
                        .unwrap_or(0);
                    warn!(message_id = %message.id, error = %err, "realtime delivery message rejected");
                }
            }
        }
    }
}

async fn process_stream_message(
    state: &AppState,
    connection: &mut MultiplexedConnection,
    message_id: &str,
    fields: &std::collections::HashMap<String, redis::Value>,
) -> Result<()> {
    let raw_delivery = fields
        .get("delivery")
        .and_then(value_to_string)
        .or_else(|| fields.get("event").and_then(value_to_string))
        .context("missing realtime delivery payload")?;
    let envelope = RealtimeDeliveryEnvelopeV1::decode(&raw_delivery)?;

    {
        let mut ops = state
            .realtime_ops
            .lock()
            .expect("realtime ops mutex poisoned");
        ops.record_delivery_request(&envelope);
    }

    let socket_ids = {
        let registry = state
            .realtime_registry
            .lock()
            .expect("realtime registry mutex poisoned");
        registry.resolve_socket_targets(&envelope.target, state.config.realtime_heartbeat_stale_secs)
    };

    if socket_ids.is_empty() {
        record_drop_reason(state, RealtimeDropReason::DeliveryNoResolvedTargets);
    } else {
        let dispatch = publish_compat_dispatch(connection, state, &envelope, socket_ids.clone()).await.map_err(
            |err| {
                record_drop_reason(state, RealtimeDropReason::DeliveryDispatchPublishFailed);
                err
            },
        )?;
        {
            let mut bridge = state
                .realtime_fanout_bridge
                .lock()
                .expect("realtime fanout bridge mutex poisoned");
            bridge.record_delivery(envelope.topic, socket_ids.len(), dispatch.emitted_at.clone());
        }
        {
            let mut ops = state
                .realtime_ops
                .lock()
                .expect("realtime ops mutex poisoned");
            ops.record_delivery_dispatch(&envelope, &dispatch);
        }
    }

    let _: usize = connection
        .xack(
            state.config.realtime_delivery_stream_key.as_str(),
            state.config.realtime_delivery_consumer_group.as_str(),
            &[message_id],
        )
        .await
        .context("ack realtime delivery stream message")?;

    Ok(())
}

async fn ensure_group(connection: &mut MultiplexedConnection, config: &GatewayConfig) -> Result<()> {
    let result: redis::RedisResult<()> = connection
        .xgroup_create_mkstream(
            config.realtime_delivery_stream_key.as_str(),
            config.realtime_delivery_consumer_group.as_str(),
            "0",
        )
        .await;
    match result {
        Ok(_) => Ok(()),
        Err(err) if err.to_string().contains("BUSYGROUP") => Ok(()),
        Err(err) => Err(err).context("create realtime delivery consumer group"),
    }
}

async fn update_stream_lag(connection: &mut MultiplexedConnection, state: &AppState) {
    let reply: redis::RedisResult<StreamInfoGroupsReply> = connection
        .xinfo_groups(state.config.realtime_delivery_stream_key.as_str())
        .await;
    match reply {
        Ok(groups) => {
            let lag = groups
                .groups
                .into_iter()
                .find(|group| group.name == state.config.realtime_delivery_consumer_group)
                .and_then(|group| group.lag.map(|value| value as u64));
            let mut ops = state
                .realtime_ops
                .lock()
                .expect("realtime ops mutex poisoned");
            ops.set_delivery_stream_lag(lag);
        }
        Err(err) => {
            record_drop_reason(state, RealtimeDropReason::DeliveryStreamReadFailed);
            warn!(error = %err, "failed to update realtime delivery lag");
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
        .context("write realtime delivery dlq entry")
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
        unit: "realtime_delivery_boundary",
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
        unit: "realtime_delivery_boundary",
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
    ops.record_delivery_drop_reason(reason);
}

fn value_to_string(value: &redis::Value) -> Option<String> {
    redis::from_redis_value::<String>(value).ok()
}
