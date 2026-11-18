use std::{net::SocketAddr, time::Instant};

use axum::{
    body::Body,
    extract::{ConnectInfo, Request, State},
    http::StatusCode,
    response::Response,
};
use futures_util::TryStreamExt;
use tracing::warn;

use crate::{
    error::GatewayError,
    ingress::path_normalizer::{is_blocked_external_path, normalize_uri_path},
    ingress_audit::IngressEventKind,
    probes::{mark_proxy_failure, mark_proxy_recovery},
    request_context::RequestContext,
    state::AppState,
};

use super::{
    handlers::HOP_BY_HOP_HEADERS,
    header_sanitizer::{build_client_response_headers, is_websocket_upgrade_request},
    proxy_support::{
        copy_request_headers, log_proxy_failure, log_proxy_success, record_ingress_event,
    },
    websocket_proxy::proxy_websocket_upgrade,
};

pub async fn proxy_handler(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    request: Request,
) -> Result<Response, GatewayError> {
    let started_at = Instant::now();

    // 1. 先执行 URI 路径规范化与非法穿越拦截，确保网关策略与上游看到完全一致的路径
    let normalized_path =
        normalize_uri_path(request.uri().path()).map_err(|_| GatewayError::BadRequest)?;

    let request_context = RequestContext::from_headers(
        &state.config,
        request.headers(),
        addr.ip(),
        &normalized_path,
    );

    // 2. 显式阻断外部访问 `/internal/*`、`/ready` 及未注册的 `/gateway/ops/*` 端点
    if is_blocked_external_path(&normalized_path) {
        record_ingress_event(
            &state,
            &request_context,
            request.method().as_str(),
            &normalized_path,
            IngressEventKind::Forbidden,
            Some(StatusCode::FORBIDDEN.as_u16()),
            started_at.elapsed(),
            Some("blocked external access to internal endpoint".to_string()),
        );
        warn!(
            request_id = %request_context.request_id,
            client_ip = %request_context.client_ip,
            path = %normalized_path,
            "blocked external request to internal endpoint"
        );
        return Err(GatewayError::Forbidden);
    }

    // 3. 按路由类别执行限流（SocketIoCompat 使用更高配额，防止正常轮询/握手触发 429 重连风暴）
    let decision = if request_context.rate_limit_bypassed {
        None
    } else {
        let (capacity, refill_per_sec) = request_context.route_class.rate_limit_budget(
            state.config.rate_limit_capacity,
            state.config.rate_limit_refill_per_sec,
        );
        let decision = state.limiter.check_with_limits(
            &request_context
                .route_class
                .bucket_key(&request_context.client_ip),
            capacity,
            refill_per_sec,
        );
        if !decision.allowed {
            record_ingress_event(
                &state,
                &request_context,
                request.method().as_str(),
                &normalized_path,
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

    // 4. 对受保护路由执行 Bearer Token 边缘预校验
    if state.config.validate_access_tokens
        && !request_context.jwt_prevalidation_bypassed
        && let Some(validator) = &state.jwt_validator
    {
        validator
            .maybe_validate_bearer(request.headers())
            .map_err(|_| {
                record_ingress_event(
                    &state,
                    &request_context,
                    request.method().as_str(),
                    &normalized_path,
                    IngressEventKind::Unauthorized,
                    Some(StatusCode::UNAUTHORIZED.as_u16()),
                    started_at.elapsed(),
                    Some("bearer token failed gateway prevalidation".to_string()),
                );
                GatewayError::Unauthorized
            })?;
    }

    // 5. 若为 WebSocket 升级握手（如 `socketTerminator=node` 模式下的 `/socket.io/`），走 `101` 双向隧道
    if is_websocket_upgrade_request(request.headers()) {
        return proxy_websocket_upgrade(
            &state,
            request,
            &request_context,
            decision,
            &normalized_path,
            started_at,
        )
        .await;
    }

    // 6. 普通 HTTP 流式代理（使用规范化后的路径与单值清洗后的 HeaderMap）
    let method = request.method().clone();
    let query = request.uri().query().map(str::to_owned);
    let request_headers = request.headers().clone();
    let upstream_url = match query.as_deref() {
        Some(q) if !q.is_empty() => {
            format!("{}{}?{}", state.config.upstream_http, normalized_path, q)
        }
        _ => format!("{}{}", state.config.upstream_http, normalized_path),
    };

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
    )?;

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
                &normalized_path,
                IngressEventKind::UpstreamUnavailable,
                None,
                started_at.elapsed(),
                Some(err.to_string()),
            );
            log_proxy_failure(
                &request_context,
                &method,
                &normalized_path,
                started_at.elapsed(),
                &err,
            );
            mark_proxy_failure(
                &state,
                format!("proxy {} {} failed: {err}", method, normalized_path),
            );
            GatewayError::UpstreamUnavailable
        })?;

    mark_proxy_recovery(&state, format!("proxy {} {}", method, normalized_path));

    let status = upstream_response.status();
    let upstream_headers = upstream_response.headers().clone();
    let response_headers = build_client_response_headers(
        &upstream_headers,
        &request_context,
        decision,
        &HOP_BY_HOP_HEADERS,
        false,
    )?;
    let stream = upstream_response
        .bytes_stream()
        .map_err(|err| std::io::Error::other(err.to_string()));

    log_proxy_success(
        &request_context,
        &method,
        &normalized_path,
        status.as_u16(),
        started_at.elapsed(),
    );
    record_ingress_event(
        &state,
        &request_context,
        method.as_str(),
        &normalized_path,
        IngressEventKind::Proxied,
        Some(status.as_u16()),
        started_at.elapsed(),
        None,
    );

    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = status;
    *response.headers_mut() = response_headers;
    Ok(response)
}
