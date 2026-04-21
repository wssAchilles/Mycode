use anyhow::{Context, Result};
use chrono::Utc;
use redis::{AsyncCommands, aio::MultiplexedConnection};
use uuid::Uuid;

use crate::{
    realtime_contracts::{
        REALTIME_COMPAT_DISPATCH_SPEC_VERSION, RealtimeCompatDispatchEnvelopeV1,
        RealtimeCompatDispatchTarget, RealtimeDeliveryEnvelopeV1,
    },
    state::AppState,
};

pub async fn publish_compat_dispatch(
    connection: &mut MultiplexedConnection,
    state: &AppState,
    envelope: &RealtimeDeliveryEnvelopeV1,
    socket_ids: Vec<String>,
) -> Result<RealtimeCompatDispatchEnvelopeV1> {
    let dispatch = RealtimeCompatDispatchEnvelopeV1 {
        spec_version: REALTIME_COMPAT_DISPATCH_SPEC_VERSION.to_string(),
        dispatch_id: Uuid::new_v4().to_string(),
        emitted_at: Utc::now().to_rfc3339(),
        trace_id: envelope.trace_id.clone(),
        source: "rust_realtime_edge".to_string(),
        topic: envelope.topic,
        target: RealtimeCompatDispatchTarget {
            requested_kind: envelope.target.kind,
            requested_id: envelope.target.id.clone(),
            resolved_count: socket_ids.len(),
            socket_ids,
        },
        payload: envelope.payload.clone(),
    };

    let message = serde_json::to_string(&dispatch).context("serialize compat dispatch envelope")?;
    let _: usize = connection
        .publish(
            state.config.realtime_compat_dispatch_channel.as_str(),
            message,
        )
        .await
        .context("publish realtime compat dispatch envelope")?;
    Ok(dispatch)
}
