use std::sync::{Arc, Mutex};

use serde::Serialize;
use socketioxide::SocketIo;

use crate::{
    config::GatewayConfig, control_plane::LifecycleStatus, fanout_bridge::FanoutBridge,
    ingress_audit::IngressAuditTrail, jwt::JwtPrevalidator, presence_router::PresenceRouter,
    rate_limit::RateLimiter, realtime::socket::state::RustSocketSessionStore,
    realtime_ops::RealtimeOpsState, session_registry::RealtimeSessionRegistry,
};

#[derive(Clone)]
pub struct AppState {
    pub config: GatewayConfig,
    pub client: reqwest::Client,
    pub limiter: RateLimiter,
    pub control_plane: Arc<Mutex<crate::control_plane::RuntimeControlPlane>>,
    pub ingress_audit: Arc<Mutex<IngressAuditTrail>>,
    pub jwt_validator: Option<JwtPrevalidator>,
    pub realtime_registry: Arc<Mutex<RealtimeSessionRegistry>>,
    pub realtime_presence: Arc<Mutex<PresenceRouter>>,
    pub realtime_ops: Arc<Mutex<RealtimeOpsState>>,
    pub realtime_fanout_bridge: Arc<Mutex<FanoutBridge>>,
    pub realtime_socket_state: Arc<Mutex<RustSocketSessionStore>>,
    pub realtime_socket_io: Option<SocketIo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub ok: bool,
    pub gateway: GatewayStatusPayload,
    pub upstream: UpstreamHealthPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStatusPayload {
    pub overall_status: LifecycleStatus,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpstreamHealthPayload {
    pub reachable: bool,
    pub status_code: Option<u16>,
    pub detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryPayload {
    pub summary: String,
}
