use std::time::{Duration, Instant};

use axum::{
    body::Body,
    extract::Request,
    http::{HeaderValue, StatusCode, header},
    response::Response,
};
use bytes::Bytes;
use http_body_util::{BodyExt, Empty};
use hyper_util::rt::TokioIo;
use tokio::{io::copy_bidirectional, net::TcpStream, time::timeout};
use tracing::{debug, warn};
use url::Url;

use crate::{
    error::GatewayError, ingress_audit::IngressEventKind, rate_limit::RateLimitDecision,
    request_context::RequestContext, state::AppState,
};

use super::{
    handlers::HOP_BY_HOP_HEADERS,
    header_sanitizer::{build_client_response_headers, build_upstream_request_headers},
    proxy_support::record_ingress_event,
};

const UPSTREAM_WS_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);

/// 执行 HTTP `101 Switching Protocols` WebSocket 双向升级透传（用于 `socketTerminator=node` 兼容模式）
pub async fn proxy_websocket_upgrade(
    state: &AppState,
    mut request: Request,
    request_context: &RequestContext,
    decision: Option<RateLimitDecision>,
    normalized_path: &str,
    started_at: Instant,
) -> Result<Response, GatewayError> {
    let method = request.method().clone();
    let query = request.uri().query();
    let target_path_and_query = match query {
        Some(q) if !q.is_empty() => format!("{normalized_path}?{q}"),
        _ => normalized_path.to_string(),
    };
    let upstream_full_url = format!("{}{}", state.config.upstream_http, target_path_and_query);
    let parsed_url = Url::parse(&upstream_full_url).map_err(|_| GatewayError::Internal)?;
    let host = parsed_url
        .host_str()
        .ok_or(GatewayError::Internal)?
        .to_string();
    let port = parsed_url
        .port_or_known_default()
        .ok_or(GatewayError::Internal)?;
    let host_header = match parsed_url.port() {
        Some(explicit_port) => format!("{host}:{explicit_port}"),
        None => host.clone(),
    };

    let upstream_headers = build_upstream_request_headers(
        request.headers(),
        request_context,
        &HOP_BY_HOP_HEADERS,
        true,
    )?;

    // 在消费客户端请求前先注册客户端侧升级句柄
    let client_on_upgrade = hyper::upgrade::on(&mut request);

    let tcp_stream = timeout(
        UPSTREAM_WS_HANDSHAKE_TIMEOUT,
        TcpStream::connect((host.as_str(), port)),
    )
    .await
    .map_err(|_| GatewayError::UpstreamUnavailable)?
    .map_err(|err| {
        warn!(
            request_id = %request_context.request_id,
            path = %normalized_path,
            error = %err,
            "failed to connect upstream tcp for websocket upgrade"
        );
        record_ingress_event(
            state,
            request_context,
            method.as_str(),
            normalized_path,
            IngressEventKind::UpstreamUnavailable,
            None,
            started_at.elapsed(),
            Some(err.to_string()),
        );
        GatewayError::UpstreamUnavailable
    })?;
    let _ = tcp_stream.set_nodelay(true);

    let (mut sender, conn) = timeout(
        UPSTREAM_WS_HANDSHAKE_TIMEOUT,
        hyper::client::conn::http1::handshake(TokioIo::new(tcp_stream)),
    )
    .await
    .map_err(|_| GatewayError::UpstreamUnavailable)?
    .map_err(|_| GatewayError::UpstreamUnavailable)?;

    // 必须启用 `with_upgrades()` 以便在 `101` 后移交底层连接字节流
    tokio::spawn(async move {
        if let Err(err) = conn.with_upgrades().await {
            debug!(error = %err, "upstream websocket http1 connection driver ended");
        }
    });

    let mut upstream_req = http::Request::builder()
        .method(method.clone())
        .uri(&target_path_and_query)
        .body(Empty::<Bytes>::new())
        .map_err(|_| GatewayError::Internal)?;
    *upstream_req.headers_mut() = upstream_headers;
    upstream_req.headers_mut().insert(
        header::HOST,
        HeaderValue::from_str(&host_header).map_err(|_| GatewayError::Internal)?,
    );

    let mut upstream_res = timeout(
        UPSTREAM_WS_HANDSHAKE_TIMEOUT,
        sender.send_request(upstream_req),
    )
    .await
    .map_err(|_| GatewayError::UpstreamUnavailable)?
    .map_err(|err| {
        warn!(
            request_id = %request_context.request_id,
            path = %normalized_path,
            error = %err,
            "upstream websocket handshake failed"
        );
        record_ingress_event(
            state,
            request_context,
            method.as_str(),
            normalized_path,
            IngressEventKind::UpstreamUnavailable,
            None,
            started_at.elapsed(),
            Some(err.to_string()),
        );
        GatewayError::UpstreamUnavailable
    })?;

    let status = upstream_res.status();
    if status != StatusCode::SWITCHING_PROTOCOLS {
        // 上游拒绝升级（如 400/401/403）时，按普通 HTTP 响应透传返回
        let response_headers = build_client_response_headers(
            upstream_res.headers(),
            request_context,
            decision,
            &HOP_BY_HOP_HEADERS,
            false,
        )?;
        let body_bytes = upstream_res
            .into_body()
            .collect()
            .await
            .map(|collected| collected.to_bytes())
            .unwrap_or_default();
        record_ingress_event(
            state,
            request_context,
            method.as_str(),
            normalized_path,
            IngressEventKind::Proxied,
            Some(status.as_u16()),
            started_at.elapsed(),
            Some("websocket upgrade rejected by upstream".to_string()),
        );
        let mut response = Response::new(Body::from(body_bytes));
        *response.status_mut() = status;
        *response.headers_mut() = response_headers;
        return Ok(response);
    }

    let response_headers = build_client_response_headers(
        upstream_res.headers(),
        request_context,
        decision,
        &HOP_BY_HOP_HEADERS,
        true,
    )?;
    let upstream_on_upgrade = hyper::upgrade::on(&mut upstream_res);
    let request_id = request_context.request_id.clone();

    // 启动异步双向全双工字节流拷贝任务
    tokio::spawn(async move {
        match tokio::try_join!(client_on_upgrade, upstream_on_upgrade) {
            Ok((client_upgraded, upstream_upgraded)) => {
                let mut client_io = TokioIo::new(client_upgraded);
                let mut upstream_io = TokioIo::new(upstream_upgraded);
                if let Err(err) = copy_bidirectional(&mut client_io, &mut upstream_io).await {
                    debug!(request_id = %request_id, error = %err, "websocket tunnel closed");
                }
            }
            Err(err) => {
                debug!(request_id = %request_id, error = %err, "websocket upgrade completion failed");
            }
        }
    });

    record_ingress_event(
        state,
        request_context,
        method.as_str(),
        normalized_path,
        IngressEventKind::Proxied,
        Some(StatusCode::SWITCHING_PROTOCOLS.as_u16()),
        started_at.elapsed(),
        Some("websocket 101 switching protocols".to_string()),
    );

    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::SWITCHING_PROTOCOLS;
    *response.headers_mut() = response_headers;
    Ok(response)
}
