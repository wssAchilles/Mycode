use std::{net::SocketAddr, time::Instant};

use axum::{
    Json,
    body::Body,
    extract::{ConnectInfo, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures_util::TryStreamExt;
use tracing::{error, info, warn};

use crate::{
    error::GatewayError,
    probes::{control_plane_snapshot, mark_proxy_failure, mark_proxy_recovery, probe_upstream},
    request_context::RequestContext,
    state::{
        AppState, GatewayStatusPayload, HealthResponse, SummaryPayload, UpstreamHealthPayload,
    },
    traffic_policy::policy_catalog,
};

const HOP_BY_HOP_HEADERS: [&str; 8] = [
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

pub async fn health_handler(State(state): State<AppState>) -> Response {
    let upstream = probe_upstream(&state).await.unwrap_or_else(|err| {
        error!(error = %err, "failed to probe upstream");
        UpstreamHealthPayload {
            reachable: false,
            status_code: None,
            detail: "upstream probe failed".to_string(),
        }
    });
    let snapshot = control_plane_snapshot(&state);
    let ok = upstream.reachable
        && !matches!(
            snapshot.overall_status,
            crate::control_plane::LifecycleStatus::Failed
                | crate::control_plane::LifecycleStatus::Blocked
        );
    let status = if ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status,
        axum::Json(HealthResponse {
            ok,
            gateway: GatewayStatusPayload {
                overall_status: snapshot.overall_status,
                summary: snapshot.summary,
            },
            upstream,
        }),
    )
        .into_response()
}

pub async fn control_plane_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, GatewayError> {
    verify_ops_token(&state, &headers)?;
    Ok(axum::Json(control_plane_snapshot(&state)))
}

pub async fn control_plane_summary_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, GatewayError> {
    verify_ops_token(&state, &headers)?;
    let snapshot = control_plane_snapshot(&state);
    Ok(axum::Json(SummaryPayload {
        summary: snapshot.summary,
    }))
}

pub async fn ingress_policy_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, GatewayError> {
    verify_ops_token(&state, &headers)?;
    Ok(Json(policy_catalog(
        state.config.request_timeout_secs,
        state.config.sync_request_timeout_secs,
    )))
}

pub async fn proxy_handler(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    request: Request,
) -> Result<Response, GatewayError> {
    let started_at = Instant::now();
    let request_context = RequestContext::from_headers(
        &state.config,
        request.headers(),
        addr.ip(),
        request.uri().path(),
    );

    let decision = if request_context.rate_limit_bypassed {
        None
    } else {
        let decision = state.limiter.check(
            &request_context
                .route_class
                .bucket_key(&request_context.client_ip),
        );
        if !decision.allowed {
            warn!(
                request_id = %request_context.request_id,
                client_ip = %request_context.client_ip,
                route_class = %request_context.route_class,
                retry_after_secs = decision.retry_after_secs,
                "gateway rate limit hit"
            );
            return Err(GatewayError::RateLimited {
                retry_after_secs: decision.retry_after_secs,
            });
        }
        Some(decision)
    };

    if state.config.validate_access_tokens && !request_context.jwt_prevalidation_bypassed {
        if let Some(validator) = &state.jwt_validator {
            validator
                .maybe_validate_bearer(request.headers())
                .map_err(|_| GatewayError::Unauthorized)?;
        }
    }

    let method = request.method().clone();
    let uri = request.uri().clone();
    let request_headers = request.headers().clone();
    let upstream_url = format!(
        "{}{}",
        state.config.upstream_http,
        uri.path_and_query()
            .map(|value| value.as_str())
            .unwrap_or(uri.path())
    );

    let mut builder =
        state
            .client
            .request(method.clone(), upstream_url)
            .timeout(std::time::Duration::from_secs(
                request_context.request_timeout_secs,
            ));
    builder = copy_request_headers(builder, &request_headers, &request_context);
    let body_stream =
        futures_util::TryStreamExt::map_err(request.into_body().into_data_stream(), |err| {
            std::io::Error::other(err.to_string())
        });
    let upstream_response = builder
        .body(reqwest::Body::wrap_stream(body_stream))
        .send()
        .await
        .map_err(|err| {
            log_proxy_failure(
                &request_context,
                &method,
                uri.path(),
                started_at.elapsed(),
                &err,
            );
            mark_proxy_failure(
                &state,
                format!("proxy {} {} failed: {err}", method, uri.path()),
            );
            GatewayError::UpstreamUnavailable
        })?;

    mark_proxy_recovery(&state, format!("proxy {} {}", method, uri.path()));

    let status = upstream_response.status();
    let headers = upstream_response.headers().clone();
    let stream = upstream_response
        .bytes_stream()
        .map_err(|err| std::io::Error::other(err.to_string()));
    let mut response_builder = Response::builder().status(status);
    for (name, value) in headers.iter() {
        if is_hop_by_hop(name) {
            continue;
        }
        response_builder = response_builder.header(name, value);
    }
    response_builder = response_builder
        .header("x-gateway-ingress", "rust")
        .header(
            "x-gateway-route-class",
            request_context.route_class.as_str(),
        )
        .header(
            "x-gateway-request-timeout-secs",
            header_value(&request_context.request_timeout_secs.to_string())?,
        )
        .header("x-request-id", header_value(&request_context.request_id)?);
    if let Some(chat_trace_id) = request_context.chat_trace_id.as_ref() {
        response_builder = response_builder.header("x-chat-trace-id", header_value(chat_trace_id)?);
    }
    if let Some(decision) = decision {
        response_builder = response_builder.header(
            "x-ratelimit-remaining",
            HeaderValue::from_str(&decision.remaining.to_string())
                .unwrap_or_else(|_| HeaderValue::from_static("0")),
        );
    } else {
        response_builder = response_builder.header(
            "x-gateway-rate-limit-bypass",
            HeaderValue::from_static("true"),
        );
    }

    log_proxy_success(
        &request_context,
        &method,
        uri.path(),
        status.as_u16(),
        started_at.elapsed(),
    );

    response_builder
        .body(Body::from_stream(stream))
        .map_err(|_| GatewayError::Internal)
}

fn copy_request_headers(
    mut builder: reqwest::RequestBuilder,
    headers: &HeaderMap,
    request_context: &RequestContext,
) -> reqwest::RequestBuilder {
    for (name, value) in headers.iter() {
        if name == header::HOST || is_hop_by_hop(name) {
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

fn is_hop_by_hop(name: &HeaderName) -> bool {
    HOP_BY_HOP_HEADERS
        .iter()
        .any(|header_name| name.as_str().eq_ignore_ascii_case(header_name))
}

fn header_value(value: &str) -> Result<HeaderValue, GatewayError> {
    HeaderValue::from_str(value).map_err(|_| GatewayError::Internal)
}

fn log_proxy_success(
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

fn log_proxy_failure(
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

fn verify_ops_token(state: &AppState, headers: &HeaderMap) -> Result<(), GatewayError> {
    let Some(expected) = state.config.ops_token.as_deref() else {
        return Ok(());
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
    let provided = from_header.or(from_bearer).unwrap_or_default();
    if provided != expected {
        return Err(GatewayError::Unauthorized);
    }
    Ok(())
}
