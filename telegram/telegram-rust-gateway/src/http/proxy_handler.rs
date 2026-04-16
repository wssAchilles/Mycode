use std::{net::SocketAddr, time::Instant};

use axum::{
    body::Body,
    extract::{ConnectInfo, Request, State},
    http::{HeaderValue, StatusCode},
    response::Response,
};
use futures_util::TryStreamExt;
use tracing::warn;

use crate::{
    error::GatewayError,
    ingress_audit::IngressEventKind,
    probes::{mark_proxy_failure, mark_proxy_recovery},
    request_context::RequestContext,
    state::AppState,
};

use super::handlers::HOP_BY_HOP_HEADERS;
use super::proxy_support::{
    copy_request_headers, header_value, is_hop_by_hop, log_proxy_failure, log_proxy_success,
    record_ingress_event,
};

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
            record_ingress_event(
                &state,
                &request_context,
                request.method().as_str(),
                request.uri().path(),
                IngressEventKind::RateLimited,
                Some(StatusCode::TOO_MANY_REQUESTS.as_u16()),
                started_at.elapsed(),
                Some(format!("retry after {}s", decision.retry_after_secs)),
            );
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
                .map_err(|_| {
                    record_ingress_event(
                        &state,
                        &request_context,
                        request.method().as_str(),
                        request.uri().path(),
                        IngressEventKind::Unauthorized,
                        Some(StatusCode::UNAUTHORIZED.as_u16()),
                        started_at.elapsed(),
                        Some("bearer token failed gateway prevalidation".to_string()),
                    );
                    GatewayError::Unauthorized
                })?;
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
    builder = copy_request_headers(
        builder,
        &request_headers,
        &request_context,
        &HOP_BY_HOP_HEADERS,
    );
    let body_stream =
        futures_util::TryStreamExt::map_err(request.into_body().into_data_stream(), |err| {
            std::io::Error::other(err.to_string())
        });
    let upstream_response = builder
        .body(reqwest::Body::wrap_stream(body_stream))
        .send()
        .await
        .map_err(|err| {
            record_ingress_event(
                &state,
                &request_context,
                method.as_str(),
                uri.path(),
                IngressEventKind::UpstreamUnavailable,
                None,
                started_at.elapsed(),
                Some(err.to_string()),
            );
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
        if is_hop_by_hop(name, &HOP_BY_HOP_HEADERS) {
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
    record_ingress_event(
        &state,
        &request_context,
        method.as_str(),
        uri.path(),
        IngressEventKind::Proxied,
        Some(status.as_u16()),
        started_at.elapsed(),
        None,
    );

    response_builder
        .body(Body::from_stream(stream))
        .map_err(|_| GatewayError::Internal)
}
