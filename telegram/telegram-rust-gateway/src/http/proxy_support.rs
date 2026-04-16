use axum::http::{HeaderMap, HeaderName, HeaderValue, header};
use tracing::{info, warn};

use crate::{
    config::GatewayRealtimeRolloutStage,
    error::GatewayError,
    ingress_audit::{IngressAuditSnapshot, IngressEventInput, IngressEventKind},
    realtime_contracts::RealtimeRolloutStage,
    request_context::RequestContext,
    state::AppState,
};

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
