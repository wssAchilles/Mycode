use std::collections::BTreeMap;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const REALTIME_EVENT_SPEC_VERSION: &str = "realtime.event.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RealtimeTopic {
    SessionOpened,
    SessionClosed,
    SessionHeartbeat,
    PresenceUpdated,
    TypingUpdated,
    MessageCommandRequested,
    ReadAckRequested,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RealtimeRolloutStage {
    Shadow,
    CompatPrimary,
    RustEdgePrimary,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RealtimeDropReason {
    InvalidEvent,
    UnsupportedTopic,
    DlqWriteFailed,
    StreamReadFailed,
    StreamParseFailed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeEventEnvelopeV1 {
    pub spec_version: String,
    pub event_id: String,
    pub topic: RealtimeTopic,
    pub emitted_at: String,
    pub partition_key: String,
    pub trace_id: String,
    pub source: String,
    pub session_id: String,
    pub user_id: Option<String>,
    pub chat_id: Option<String>,
    pub payload: Value,
}

impl RealtimeEventEnvelopeV1 {
    pub fn decode(raw: &str) -> Result<Self> {
        let envelope: Self = serde_json::from_str(raw).context("decode realtime event envelope")?;
        if envelope.spec_version != REALTIME_EVENT_SPEC_VERSION {
            bail!("unsupported realtime specVersion: {}", envelope.spec_version);
        }
        if envelope.event_id.trim().is_empty() || envelope.session_id.trim().is_empty() {
            bail!("invalid realtime envelope: eventId/sessionId required");
        }
        Ok(envelope)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeRecentEvent {
    pub event_id: String,
    pub topic: RealtimeTopic,
    pub emitted_at: String,
    pub session_id: String,
    pub user_id: Option<String>,
    pub chat_id: Option<String>,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayRealtimeOpsResponse {
    pub mode: String,
    pub current_stage: RealtimeRolloutStage,
    pub session_count: usize,
    pub authenticated_session_count: usize,
    pub subscription_count: usize,
    pub presence_state_counts: BTreeMap<String, usize>,
    pub ingress_stream_lag: Option<u64>,
    pub drop_reasons: BTreeMap<String, u64>,
    pub auth_failures: BTreeMap<String, u64>,
    pub compat_hits: u64,
    pub last_event_at: Option<String>,
    pub consumer_group: String,
    pub consumer_name: String,
    pub registry: Value,
    pub fanout_bridge: Value,
    pub recent_events: Vec<RealtimeRecentEvent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayRealtimeSummaryResponse {
    pub status: String,
    pub current_stage: RealtimeRolloutStage,
    pub current_blocker: Option<String>,
    pub recommended_action: String,
    pub summary: String,
}
