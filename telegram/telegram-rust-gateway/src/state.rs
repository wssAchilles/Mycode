use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::{
    config::GatewayConfig, control_plane::LifecycleStatus, ingress_audit::IngressAuditTrail,
    jwt::JwtPrevalidator, rate_limit::RateLimiter,
};

#[derive(Clone)]
pub struct AppState {
    pub config: GatewayConfig,
    pub client: reqwest::Client,
    pub limiter: RateLimiter,
    pub control_plane: Arc<Mutex<crate::control_plane::RuntimeControlPlane>>,
    pub ingress_audit: Arc<Mutex<IngressAuditTrail>>,
    pub jwt_validator: Option<JwtPrevalidator>,
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
