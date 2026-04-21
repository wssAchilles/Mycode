use std::collections::BTreeMap;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const REALTIME_EVENT_SPEC_VERSION: &str = "realtime.event.v1";
pub const REALTIME_DELIVERY_SPEC_VERSION: &str = "realtime.delivery.v1";
pub const REALTIME_COMPAT_DISPATCH_SPEC_VERSION: &str = "realtime.compat.dispatch.v1";

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
pub enum RealtimeDeliveryTopic {
    Message,
    Presence,
    Typing,
    ReadReceipt,
    GroupUpdate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RealtimeDeliveryTargetKind {
    Socket,
    User,
    Room,
    Broadcast,
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
pub enum RealtimeFanoutOwner {
    Node,
    Rust,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RealtimeSocketTerminator {
    Node,
    Rust,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RealtimeCatalogTransportName {
    RustSocketIoCompat,
    NodeSocketIoCompat,
    SyncV2LongPoll,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RealtimeDropReason {
    InvalidEvent,
    UnsupportedTopic,
    DlqWriteFailed,
    StreamReadFailed,
    StreamParseFailed,
    DeliveryInvalidEvent,
    DeliveryUnsupportedTarget,
    DeliveryNoResolvedTargets,
    DeliveryDispatchPublishFailed,
    DeliveryStreamReadFailed,
    DeliveryStreamParseFailed,
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
            bail!(
                "unsupported realtime specVersion: {}",
                envelope.spec_version
            );
        }
        if envelope.event_id.trim().is_empty() || envelope.session_id.trim().is_empty() {
            bail!("invalid realtime envelope: eventId/sessionId required");
        }
        Ok(envelope)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeDeliveryTarget {
    pub kind: RealtimeDeliveryTargetKind,
    pub id: Option<String>,
    #[serde(default)]
    pub exclude_socket_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeDeliveryEnvelopeV1 {
    pub spec_version: String,
    pub delivery_id: String,
    pub topic: RealtimeDeliveryTopic,
    pub emitted_at: String,
    pub trace_id: String,
    pub source: String,
    pub target: RealtimeDeliveryTarget,
    pub payload: Value,
}

impl RealtimeDeliveryEnvelopeV1 {
    pub fn decode(raw: &str) -> Result<Self> {
        let envelope: Self =
            serde_json::from_str(raw).context("decode realtime delivery envelope")?;
        if envelope.spec_version != REALTIME_DELIVERY_SPEC_VERSION {
            bail!(
                "unsupported realtime delivery specVersion: {}",
                envelope.spec_version
            );
        }
        if envelope.delivery_id.trim().is_empty() {
            bail!("invalid realtime delivery envelope: deliveryId required");
        }
        Ok(envelope)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeCompatDispatchTarget {
    pub requested_kind: RealtimeDeliveryTargetKind,
    pub requested_id: Option<String>,
    pub socket_ids: Vec<String>,
    pub resolved_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeCompatDispatchEnvelopeV1 {
    pub spec_version: String,
    pub dispatch_id: String,
    pub emitted_at: String,
    pub trace_id: String,
    pub source: String,
    pub topic: RealtimeDeliveryTopic,
    pub target: RealtimeCompatDispatchTarget,
    pub payload: Value,
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
pub struct RealtimeRecentDelivery {
    pub delivery_id: String,
    pub topic: RealtimeDeliveryTopic,
    pub emitted_at: String,
    pub requested_kind: RealtimeDeliveryTargetKind,
    pub requested_id: Option<String>,
    pub source: String,
    pub resolved_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayRealtimeRuntime {
    pub rollout_stage: RealtimeRolloutStage,
    pub fanout_owner: RealtimeFanoutOwner,
    pub socket_terminator: RealtimeSocketTerminator,
    pub delivery_primary_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayRealtimeSocketIoCompatTransport {
    pub enabled: bool,
    pub path: String,
    pub owner: RealtimeSocketTerminator,
    pub fallback_owner: RealtimeSocketTerminator,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayRealtimeSyncLongPollTransport {
    pub enabled: bool,
    pub path: String,
    pub protocol_version: u8,
    pub watermark_field: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayRealtimeTransportCatalog {
    pub preferred: RealtimeCatalogTransportName,
    pub fallback: RealtimeCatalogTransportName,
    pub available: Vec<RealtimeCatalogTransportName>,
    pub socket_io_compat: GatewayRealtimeSocketIoCompatTransport,
    pub sync_v2_long_poll: GatewayRealtimeSyncLongPollTransport,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayRealtimeOpsResponse {
    pub mode: String,
    pub current_stage: RealtimeRolloutStage,
    pub runtime: GatewayRealtimeRuntime,
    pub transport: GatewayRealtimeTransportCatalog,
    pub session_count: usize,
    pub authenticated_session_count: usize,
    pub subscription_count: usize,
    pub presence_state_counts: BTreeMap<String, usize>,
    pub ingress_stream_lag: Option<u64>,
    pub delivery_stream_lag: Option<u64>,
    pub drop_reasons: BTreeMap<String, u64>,
    pub delivery_drop_reasons: BTreeMap<String, u64>,
    pub auth_failures: BTreeMap<String, u64>,
    pub compat_hits: u64,
    pub fallback_hits: u64,
    pub delivery_counts_by_topic: BTreeMap<String, u64>,
    pub delivery_counts_by_target: BTreeMap<String, u64>,
    pub last_event_at: Option<String>,
    pub last_delivery_at: Option<String>,
    pub consumer_group: String,
    pub consumer_name: String,
    pub delivery_consumer_group: String,
    pub delivery_consumer_name: String,
    pub registry: Value,
    pub fanout_bridge: Value,
    pub recent_events: Vec<RealtimeRecentEvent>,
    pub recent_deliveries: Vec<RealtimeRecentDelivery>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayRealtimeSummaryResponse {
    pub status: String,
    pub current_stage: RealtimeRolloutStage,
    pub runtime: GatewayRealtimeRuntime,
    pub transport: GatewayRealtimeTransportCatalog,
    pub current_blocker: Option<String>,
    pub recommended_action: String,
    pub summary: String,
}
