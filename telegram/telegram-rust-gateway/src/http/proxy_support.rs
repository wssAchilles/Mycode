use axum::http::{HeaderMap, HeaderName, HeaderValue, header};
use tracing::{info, warn};

use crate::{
    config::{GatewayConfig, GatewayRealtimeRolloutStage, GatewayRealtimeSocketTerminator},
    error::GatewayError,
    ingress_audit::{IngressAuditSnapshot, IngressEventInput, IngressEventKind},
    realtime_contracts::{
        GatewayRealtimeRuntime, GatewayRealtimeSocketIoCompatTransport,
        GatewayRealtimeSyncLongPollTransport, GatewayRealtimeTransportCatalog,
        RealtimeCatalogTransportName, RealtimeFanoutOwner, RealtimeRolloutStage,
        RealtimeSocketTerminator,
    },
    request_context::RequestContext,
    state::AppState,
};

const SYNC_PROTOCOL_VERSION: u8 = 2;
const SYNC_WATERMARK_FIELD: &str = "updateId";

pub fn copy_request_headers(
    mut builder: reqwest::RequestBuilder,
    headers: &HeaderMap,
    request_context: &RequestContext,
    hop_by_hop_headers: &[&str],
) -> reqwest::RequestBuilder {
    for (name, value) in headers.iter() {
        if name == header::HOST || is_hop_by_hop(name, hop_by_hop_headers) {
            continue;
        }
        builder = builder.header(name, value);
    }

    builder = builder
        .header("x-forwarded-for", request_context.forwarded_for.clone())
        .header("x-real-ip", request_context.client_ip.to_string())
        .header("x-request-id", request_context.request_id.clone())
        .header("x-gateway-ingress", "rust")
        .header(
            "x-gateway-route-class",
            request_context.route_class.as_str(),
        );
    if let Some(chat_trace_id) = request_context.chat_trace_id.as_ref() {
        builder = builder.header("x-chat-trace-id", chat_trace_id);
    }
    builder
}

pub fn is_hop_by_hop(name: &HeaderName, hop_by_hop_headers: &[&str]) -> bool {
    hop_by_hop_headers
        .iter()
        .any(|header_name| name.as_str().eq_ignore_ascii_case(header_name))
}

pub fn header_value(value: &str) -> Result<HeaderValue, GatewayError> {
    HeaderValue::from_str(value).map_err(|_| GatewayError::Internal)
}

pub fn ingress_audit_snapshot(state: &AppState) -> IngressAuditSnapshot {
    state
        .ingress_audit
        .lock()
        .expect("ingress audit mutex poisoned")
        .snapshot()
}

pub fn record_ingress_event(
    state: &AppState,
    request_context: &RequestContext,
    method: &str,
    path: &str,
    kind: IngressEventKind,
    status_code: Option<u16>,
    elapsed: std::time::Duration,
    detail: Option<String>,
) {
    state
        .ingress_audit
        .lock()
        .expect("ingress audit mutex poisoned")
        .record(IngressEventInput {
            request_id: request_context.request_id.clone(),
            chat_trace_id: request_context.chat_trace_id.clone(),
            client_ip: request_context.client_ip,
            method: method.to_string(),
            path: path.to_string(),
            route_class: request_context.route_class,
            kind,
            status_code,
            latency_ms: elapsed.as_millis() as u64,
            detail,
        });
}

pub fn log_proxy_success(
    request_context: &RequestContext,
    method: &reqwest::Method,
    path: &str,
    status_code: u16,
    elapsed: std::time::Duration,
) {
    info!(
        request_id = %request_context.request_id,
        chat_trace_id = request_context.chat_trace_id.as_deref().unwrap_or("-"),
        client_ip = %request_context.client_ip,
        route_class = %request_context.route_class,
        method = %method,
        path,
        status_code,
        latency_ms = elapsed.as_millis() as u64,
        timeout_secs = request_context.request_timeout_secs,
        rate_limit_bypassed = request_context.rate_limit_bypassed,
        jwt_prevalidation_bypassed = request_context.jwt_prevalidation_bypassed,
        "gateway proxied request"
    );
}

pub fn log_proxy_failure(
    request_context: &RequestContext,
    method: &reqwest::Method,
    path: &str,
    elapsed: std::time::Duration,
    error: &reqwest::Error,
) {
    warn!(
        request_id = %request_context.request_id,
        chat_trace_id = request_context.chat_trace_id.as_deref().unwrap_or("-"),
        client_ip = %request_context.client_ip,
        route_class = %request_context.route_class,
        method = %method,
        path,
        latency_ms = elapsed.as_millis() as u64,
        timeout_secs = request_context.request_timeout_secs,
        error = %error,
        "gateway upstream request failed"
    );
}

pub fn rollout_stage_contract(stage: GatewayRealtimeRolloutStage) -> RealtimeRolloutStage {
    match stage {
        GatewayRealtimeRolloutStage::Shadow => RealtimeRolloutStage::Shadow,
        GatewayRealtimeRolloutStage::CompatPrimary => RealtimeRolloutStage::CompatPrimary,
        GatewayRealtimeRolloutStage::RustEdgePrimary => RealtimeRolloutStage::RustEdgePrimary,
    }
}

pub fn rollout_stage_label(stage: GatewayRealtimeRolloutStage) -> &'static str {
    match stage {
        GatewayRealtimeRolloutStage::Shadow => "shadow",
        GatewayRealtimeRolloutStage::CompatPrimary => "compat_primary",
        GatewayRealtimeRolloutStage::RustEdgePrimary => "rust_edge_primary",
    }
}

pub fn realtime_runtime_contract(config: &GatewayConfig) -> GatewayRealtimeRuntime {
    GatewayRealtimeRuntime {
        rollout_stage: rollout_stage_contract(config.realtime_rollout_stage),
        fanout_owner: fanout_owner_contract(config),
        socket_terminator: socket_terminator_contract(config),
        delivery_primary_enabled: config.realtime_delivery_primary_enabled(),
    }
}

pub fn realtime_transport_catalog_contract(
    config: &GatewayConfig,
) -> GatewayRealtimeTransportCatalog {
    let preferred = preferred_transport_contract(config);
    let fallback = fallback_transport_contract(config);
    let socket_terminator = socket_terminator_contract(config);

    GatewayRealtimeTransportCatalog {
        preferred,
        fallback,
        available: vec![
            preferred,
            fallback,
            RealtimeCatalogTransportName::SyncV2LongPoll,
        ],
        socket_io_compat: GatewayRealtimeSocketIoCompatTransport {
            enabled: true,
            path: "/socket.io/".to_string(),
            owner: socket_terminator,
            fallback_owner: fallback_socket_terminator_contract(config),
        },
        sync_v2_long_poll: GatewayRealtimeSyncLongPollTransport {
            enabled: true,
            path: "/api/sync/updates".to_string(),
            protocol_version: SYNC_PROTOCOL_VERSION,
            watermark_field: SYNC_WATERMARK_FIELD.to_string(),
        },
    }
}

fn fanout_owner_contract(config: &GatewayConfig) -> RealtimeFanoutOwner {
    if config.realtime_fanout_owner() == "rust" {
        RealtimeFanoutOwner::Rust
    } else {
        RealtimeFanoutOwner::Node
    }
}

fn socket_terminator_contract(config: &GatewayConfig) -> RealtimeSocketTerminator {
    match config.realtime_socket_terminator {
        GatewayRealtimeSocketTerminator::Rust => RealtimeSocketTerminator::Rust,
        GatewayRealtimeSocketTerminator::Node => RealtimeSocketTerminator::Node,
    }
}

fn fallback_socket_terminator_contract(config: &GatewayConfig) -> RealtimeSocketTerminator {
    match config.realtime_socket_terminator {
        GatewayRealtimeSocketTerminator::Rust => RealtimeSocketTerminator::Node,
        GatewayRealtimeSocketTerminator::Node => RealtimeSocketTerminator::Rust,
    }
}

fn preferred_transport_contract(config: &GatewayConfig) -> RealtimeCatalogTransportName {
    match config.realtime_socket_terminator {
        GatewayRealtimeSocketTerminator::Rust => RealtimeCatalogTransportName::RustSocketIoCompat,
        GatewayRealtimeSocketTerminator::Node => RealtimeCatalogTransportName::NodeSocketIoCompat,
    }
}

fn fallback_transport_contract(config: &GatewayConfig) -> RealtimeCatalogTransportName {
    match config.realtime_socket_terminator {
        GatewayRealtimeSocketTerminator::Rust => RealtimeCatalogTransportName::NodeSocketIoCompat,
        GatewayRealtimeSocketTerminator::Node => RealtimeCatalogTransportName::RustSocketIoCompat,
    }
}

#[cfg(test)]
mod tests {
    use std::net::{Ipv4Addr, SocketAddr};

    use super::{realtime_runtime_contract, realtime_transport_catalog_contract};
    use crate::{
        config::{GatewayConfig, GatewayRealtimeRolloutStage, GatewayRealtimeSocketTerminator},
        realtime_contracts::{
            RealtimeCatalogTransportName, RealtimeFanoutOwner, RealtimeSocketTerminator,
        },
    };

    fn config() -> GatewayConfig {
        GatewayConfig {
            bind_addr: SocketAddr::from((Ipv4Addr::LOCALHOST, 4000)),
            upstream_http: "http://backend:5000".to_string(),
            ops_token: None,
            jwt_secret: Some("secret".to_string()),
            validate_access_tokens: true,
            trust_x_forwarded_for: true,
            rate_limit_capacity: 120.0,
            rate_limit_refill_per_sec: 2.0,
            request_timeout_secs: 30,
            sync_request_timeout_secs: 45,
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
        }
    }

    #[test]
    fn runtime_contract_tracks_dual_semantics() {
        let mut config = config();
        config.realtime_rollout_stage = GatewayRealtimeRolloutStage::RustEdgePrimary;

        let runtime = realtime_runtime_contract(&config);

        assert_eq!(runtime.fanout_owner, RealtimeFanoutOwner::Rust);
        assert_eq!(runtime.socket_terminator, RealtimeSocketTerminator::Node);
        assert!(runtime.delivery_primary_enabled);
    }

    #[test]
    fn transport_catalog_follows_socket_terminator_instead_of_rollout() {
        let mut config = config();
        config.realtime_rollout_stage = GatewayRealtimeRolloutStage::RustEdgePrimary;
        config.realtime_socket_terminator = GatewayRealtimeSocketTerminator::Rust;

        let transport = realtime_transport_catalog_contract(&config);

        assert_eq!(
            transport.preferred,
            RealtimeCatalogTransportName::RustSocketIoCompat
        );
        assert_eq!(
            transport.fallback,
            RealtimeCatalogTransportName::NodeSocketIoCompat
        );
        assert_eq!(
            transport.available,
            vec![
                RealtimeCatalogTransportName::RustSocketIoCompat,
                RealtimeCatalogTransportName::NodeSocketIoCompat,
                RealtimeCatalogTransportName::SyncV2LongPoll,
            ]
        );
        assert_eq!(
            transport.socket_io_compat.owner,
            RealtimeSocketTerminator::Rust
        );
        assert_eq!(
            transport.socket_io_compat.fallback_owner,
            RealtimeSocketTerminator::Node
        );
    }
}
