use axum::http::{HeaderMap, header};

use crate::{error::GatewayError, state::AppState};

/// 恒定时间字节比较，防止时序侧信道探测运维密钥
fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&a, &b) in left.iter().zip(right.iter()) {
        diff |= a ^ b;
    }
    diff == 0
}

/// 校验 `/gateway/ops/*` 访问凭证（缺省 Fail-Closed：未配置 Ops Token 时一律拒绝访问）
pub fn verify_ops_token(state: &AppState, headers: &HeaderMap) -> Result<(), GatewayError> {
    let Some(expected) = state
        .config
        .ops_token
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err(GatewayError::Unauthorized);
    };
    let from_header = headers
        .get("x-ops-token")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let from_bearer = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .strip_prefix("Bearer ")
                .or_else(|| value.strip_prefix("bearer "))
        })
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let Some(provided) = from_header.or(from_bearer) else {
        return Err(GatewayError::Unauthorized);
    };
    if !constant_time_eq(provided.as_bytes(), expected.as_bytes()) {
        return Err(GatewayError::Unauthorized);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        net::{Ipv4Addr, SocketAddr},
        sync::{Arc, Mutex},
    };

    use axum::http::{HeaderMap, HeaderValue};

    use super::verify_ops_token;
    use crate::{
        config::{GatewayConfig, GatewayRealtimeRolloutStage, GatewayRealtimeSocketTerminator},
        fanout_bridge::FanoutBridge,
        ingress_audit::IngressAuditTrail,
        presence_router::PresenceRouter,
        rate_limit::RateLimiter,
        realtime::{socket::state::RustSocketSessionStore, state::SessionRegistryBackend},
        realtime_ops::RealtimeOpsState,
        session_registry::RealtimeSessionRegistry,
        state::AppState,
    };

    fn build_state(ops_token: Option<&str>) -> AppState {
        AppState {
            config: GatewayConfig {
                bind_addr: SocketAddr::from((Ipv4Addr::LOCALHOST, 4000)),
                upstream_http: "http://backend:5000".to_string(),
                ops_token: ops_token.map(ToString::to_string),
                jwt_secret: Some("secret".to_string()),
                validate_access_tokens: true,
                trust_x_forwarded_for: true,
                rate_limit_capacity: 120.0,
                rate_limit_refill_per_sec: 2.0,
                request_timeout_secs: 30,
                sync_request_timeout_secs: 65,
                cors_extra_origins: Vec::new(),
                realtime_redis_url: "redis://redis:6379/0".to_string(),
                realtime_stream_key: "realtime:ingress:v1".to_string(),
                realtime_delivery_stream_key: "realtime:delivery:v1".to_string(),
                realtime_dlq_stream_key: "realtime:dlq:v1".to_string(),
                realtime_consumer_group: "gateway-realtime-boundary".to_string(),
                realtime_consumer_name: "gateway-realtime-consumer".to_string(),
                realtime_delivery_consumer_group: "gateway-realtime-delivery".to_string(),
                realtime_delivery_consumer_name: "gateway-realtime-delivery-consumer".to_string(),
                realtime_compat_dispatch_channel: "realtime:compat:dispatch:v1".to_string(),
                realtime_rollout_stage: GatewayRealtimeRolloutStage::CompatPrimary,
                realtime_socket_terminator: GatewayRealtimeSocketTerminator::Node,
                realtime_heartbeat_stale_secs: 120,
                realtime_session_lease_ttl_secs: 100,
            },
            client: reqwest::Client::new(),
            limiter: RateLimiter::new(120.0, 2.0),
            control_plane: Arc::new(Mutex::new(crate::control_plane::RuntimeControlPlane::new())),
            ingress_audit: Arc::new(Mutex::new(IngressAuditTrail::new())),
            jwt_validator: None,
            session_registry: SessionRegistryBackend::InMemory(Arc::new(tokio::sync::Mutex::new(
                RealtimeSessionRegistry::default(),
            ))),
            realtime_presence: Arc::new(Mutex::new(PresenceRouter::default())),
            realtime_ops: Arc::new(Mutex::new(RealtimeOpsState::default())),
            realtime_fanout_bridge: Arc::new(Mutex::new(FanoutBridge::default())),
            realtime_socket_state: Arc::new(Mutex::new(RustSocketSessionStore::default())),
            realtime_socket_io: None,
        }
    }

    #[test]
    fn fails_closed_when_ops_token_is_missing() {
        let state = build_state(None);
        let headers = HeaderMap::new();
        assert!(verify_ops_token(&state, &headers).is_err());
    }

    #[test]
    fn accepts_valid_ops_token_and_rejects_mismatch() {
        let state = build_state(Some("top-secret-ops"));
        let mut headers = HeaderMap::new();
        headers.insert("x-ops-token", HeaderValue::from_static("wrong-token"));
        assert!(verify_ops_token(&state, &headers).is_err());

        headers.insert("x-ops-token", HeaderValue::from_static("top-secret-ops"));
        assert!(verify_ops_token(&state, &headers).is_ok());
    }
}
