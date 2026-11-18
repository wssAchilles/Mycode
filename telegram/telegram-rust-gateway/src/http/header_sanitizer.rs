use std::collections::HashSet;

use axum::http::{HeaderMap, HeaderName, HeaderValue, header};

use crate::{error::GatewayError, rate_limit::RateLimitDecision, request_context::RequestContext};

/// 转发至上游前默认必须剥离的内部服务鉴权头（仅 `CronWebhook` 路由豁免透传 `x-cron-secret`）
pub const STRIPPED_INTERNAL_HEADERS: [&str; 5] = [
    "x-recommendation-internal-token",
    "x-graph-kernel-internal-token",
    "x-cron-secret",
    "x-internal-token",
    "x-ml-internal-token",
];

/// 由边缘网关权威接管并单值覆盖的请求头
const GATEWAY_CONTROLLED_REQUEST_HEADERS: [&str; 8] = [
    "x-forwarded-for",
    "x-real-ip",
    "x-request-id",
    "x-chat-trace-id",
    "x-gateway-ingress",
    "x-gateway-route-class",
    "x-gateway-request-timeout-secs",
    "x-gateway-rate-limit-bypass",
];

/// 检测请求是否为标准 HTTP WebSocket 升级握手
pub fn is_websocket_upgrade_request(headers: &HeaderMap) -> bool {
    headers
        .get_all(header::UPGRADE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .any(|value| {
            value
                .split(',')
                .any(|token| token.trim().eq_ignore_ascii_case("websocket"))
        })
}

/// 解析 `Connection` 头中动态指定的 hop-by-hop 字段名集合（RFC 9110 §7.6.1）
pub fn parse_connection_hop_headers(headers: &HeaderMap) -> HashSet<String> {
    headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(|token| token.trim().to_ascii_lowercase())
        .filter(|token| !token.is_empty() && token != "close" && token != "keep-alive")
        .collect()
}

/// 判断字段是否属于静态或动态 hop-by-hop 头
pub fn is_effective_hop_by_hop(
    name: &HeaderName,
    static_hop_headers: &[&str],
    dynamic_hop_headers: &HashSet<String>,
) -> bool {
    let lower = name.as_str().to_ascii_lowercase();
    static_hop_headers
        .iter()
        .any(|candidate| lower == *candidate)
        || dynamic_hop_headers.contains(&lower)
}

/// 判断字段是否为外部客户端禁止伪造的内部特权头
pub fn is_stripped_internal_header(name: &HeaderName) -> bool {
    STRIPPED_INTERNAL_HEADERS
        .iter()
        .any(|candidate| name.as_str().eq_ignore_ascii_case(candidate))
}

fn is_gateway_controlled_request_header(name: &HeaderName) -> bool {
    GATEWAY_CONTROLLED_REQUEST_HEADERS
        .iter()
        .any(|candidate| name.as_str().eq_ignore_ascii_case(candidate))
}

/// 先从 `HeaderMap` 中移除同名键再单值写入，彻底杜绝 `append` 引发的重复 Header 叠加
pub fn replace_single_header(headers: &mut HeaderMap, name: HeaderName, value: HeaderValue) {
    headers.remove(&name);
    headers.insert(name, value);
}

/// 构造转发给上游服务的干净请求头映射
pub fn build_upstream_request_headers(
    client_headers: &HeaderMap,
    request_context: &RequestContext,
    hop_by_hop_headers: &[&str],
    preserve_websocket_upgrade: bool,
) -> Result<HeaderMap, GatewayError> {
    let dynamic_hops = parse_connection_hop_headers(client_headers);
    let mut sanitized = HeaderMap::with_capacity(client_headers.len() + 8);

    for (name, value) in client_headers.iter() {
        let is_allowed_cron_header = name.as_str().eq_ignore_ascii_case("x-cron-secret")
            && request_context.route_class.allow_cron_secret_passthrough();

        if name == header::HOST
            || (!is_allowed_cron_header && is_stripped_internal_header(name))
            || is_gateway_controlled_request_header(name)
        {
            continue;
        }

        if preserve_websocket_upgrade && name == header::UPGRADE {
            continue;
        }

        if is_effective_hop_by_hop(name, hop_by_hop_headers, &dynamic_hops) {
            continue;
        }

        sanitized.append(name.clone(), value.clone());
    }

    replace_single_header(
        &mut sanitized,
        HeaderName::from_static("x-forwarded-for"),
        header_value(&request_context.forwarded_for)?,
    );
    replace_single_header(
        &mut sanitized,
        HeaderName::from_static("x-real-ip"),
        header_value(&request_context.client_ip.to_string())?,
    );
    replace_single_header(
        &mut sanitized,
        HeaderName::from_static("x-request-id"),
        header_value(&request_context.request_id)?,
    );
    replace_single_header(
        &mut sanitized,
        HeaderName::from_static("x-gateway-ingress"),
        HeaderValue::from_static("rust"),
    );
    replace_single_header(
        &mut sanitized,
        HeaderName::from_static("x-gateway-route-class"),
        HeaderValue::from_static(request_context.route_class.as_str()),
    );

    if let Some(chat_trace_id) = request_context.chat_trace_id.as_ref() {
        replace_single_header(
            &mut sanitized,
            HeaderName::from_static("x-chat-trace-id"),
            header_value(chat_trace_id)?,
        );
    }

    if preserve_websocket_upgrade {
        replace_single_header(
            &mut sanitized,
            header::CONNECTION,
            HeaderValue::from_static("Upgrade"),
        );
        replace_single_header(
            &mut sanitized,
            header::UPGRADE,
            HeaderValue::from_static("websocket"),
        );
    }

    Ok(sanitized)
}

/// 构造返回给外部客户端的干净响应头映射（消除 `x-request-id` 与 `x-chat-trace-id` 重复拼接）
pub fn build_client_response_headers(
    upstream_headers: &HeaderMap,
    request_context: &RequestContext,
    decision: Option<RateLimitDecision>,
    hop_by_hop_headers: &[&str],
    preserve_websocket_upgrade: bool,
) -> Result<HeaderMap, GatewayError> {
    let dynamic_hops = if preserve_websocket_upgrade {
        HashSet::new()
    } else {
        parse_connection_hop_headers(upstream_headers)
    };
    let mut sanitized = HeaderMap::with_capacity(upstream_headers.len() + 8);

    for (name, value) in upstream_headers.iter() {
        if preserve_websocket_upgrade && (name == header::CONNECTION || name == header::UPGRADE) {
            sanitized.append(name.clone(), value.clone());
            continue;
        }
        if is_effective_hop_by_hop(name, hop_by_hop_headers, &dynamic_hops) {
            continue;
        }
        sanitized.append(name.clone(), value.clone());
    }

    // 统一先 remove 再 insert，确保所有网关追踪头在响应中严格唯一
    replace_single_header(
        &mut sanitized,
        HeaderName::from_static("x-gateway-ingress"),
        HeaderValue::from_static("rust"),
    );
    replace_single_header(
        &mut sanitized,
        HeaderName::from_static("x-gateway-route-class"),
        HeaderValue::from_static(request_context.route_class.as_str()),
    );
    replace_single_header(
        &mut sanitized,
        HeaderName::from_static("x-gateway-request-timeout-secs"),
        header_value(&request_context.request_timeout_secs.to_string())?,
    );
    replace_single_header(
        &mut sanitized,
        HeaderName::from_static("x-request-id"),
        header_value(&request_context.request_id)?,
    );

    if let Some(chat_trace_id) = request_context.chat_trace_id.as_ref() {
        replace_single_header(
            &mut sanitized,
            HeaderName::from_static("x-chat-trace-id"),
            header_value(chat_trace_id)?,
        );
    } else if let Some(upstream_trace) = sanitized
        .get("x-chat-trace-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(',').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
    {
        replace_single_header(
            &mut sanitized,
            HeaderName::from_static("x-chat-trace-id"),
            header_value(&upstream_trace)?,
        );
    }

    sanitized.remove("x-ratelimit-remaining");
    sanitized.remove("x-gateway-rate-limit-bypass");
    if let Some(decision) = decision {
        let remaining = HeaderValue::from_str(&decision.remaining.to_string())
            .unwrap_or_else(|_| HeaderValue::from_static("0"));
        replace_single_header(
            &mut sanitized,
            HeaderName::from_static("x-ratelimit-remaining"),
            remaining,
        );
    } else {
        replace_single_header(
            &mut sanitized,
            HeaderName::from_static("x-gateway-rate-limit-bypass"),
            HeaderValue::from_static("true"),
        );
    }

    Ok(sanitized)
}

pub fn header_value(value: &str) -> Result<HeaderValue, GatewayError> {
    HeaderValue::from_str(value).map_err(|_| GatewayError::Internal)
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};

    use axum::http::{HeaderMap, HeaderValue, header};

    use super::{
        build_client_response_headers, build_upstream_request_headers, is_websocket_upgrade_request,
    };
    use crate::{
        config::{GatewayConfig, GatewayRealtimeRolloutStage, GatewayRealtimeSocketTerminator},
        http::handlers::HOP_BY_HOP_HEADERS,
        rate_limit::RateLimitDecision,
        request_context::RequestContext,
    };

    fn test_config() -> GatewayConfig {
        GatewayConfig {
            bind_addr: SocketAddr::from((Ipv4Addr::LOCALHOST, 4000)),
            upstream_http: "http://backend:5000".to_string(),
            ops_token: Some("ops-secret".to_string()),
            jwt_secret: Some("jwt-secret".to_string()),
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
        }
    }

    #[test]
    fn strips_internal_headers_and_dynamic_connection_tokens_while_preserving_ops_and_cron_tokens()
    {
        let mut client_headers = HeaderMap::new();
        client_headers.insert(
            "x-recommendation-internal-token",
            HeaderValue::from_static("forged-rec"),
        );
        client_headers.insert(
            "x-graph-kernel-internal-token",
            HeaderValue::from_static("forged-graph"),
        );
        client_headers.insert(
            "x-cron-secret",
            HeaderValue::from_static("valid-cron-token"),
        );
        client_headers.insert(
            "x-internal-token",
            HeaderValue::from_static("forged-internal"),
        );
        client_headers.insert(
            "x-ml-internal-token",
            HeaderValue::from_static("forged-ml-internal"),
        );
        client_headers.insert("x-ops-token", HeaderValue::from_static("valid-ops-token"));
        client_headers.insert(
            header::CONNECTION,
            HeaderValue::from_static("keep-alive, x-dynamic-hop"),
        );
        client_headers.insert("x-dynamic-hop", HeaderValue::from_static("should-drop"));
        client_headers.append("x-request-id", HeaderValue::from_static("req-1"));
        client_headers.append("x-chat-trace-id", HeaderValue::from_static("trace-1"));

        let ctx = RequestContext::from_headers(
            &test_config(),
            &client_headers,
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)),
            "/api/news/ingest",
        );
        let sanitized =
            build_upstream_request_headers(&client_headers, &ctx, &HOP_BY_HOP_HEADERS, false)
                .expect("sanitize request headers");

        assert!(!sanitized.contains_key("x-recommendation-internal-token"));
        assert!(!sanitized.contains_key("x-graph-kernel-internal-token"));
        assert!(!sanitized.contains_key("x-internal-token"));
        assert!(!sanitized.contains_key("x-ml-internal-token"));
        assert!(!sanitized.contains_key("x-dynamic-hop"));
        assert_eq!(
            sanitized.get("x-cron-secret").and_then(|v| v.to_str().ok()),
            Some("valid-cron-token")
        );
        assert_eq!(
            sanitized.get("x-ops-token").and_then(|v| v.to_str().ok()),
            Some("valid-ops-token")
        );
        assert_eq!(sanitized.get_all("x-request-id").iter().count(), 1);
        assert_eq!(sanitized.get_all("x-chat-trace-id").iter().count(), 1);

        // 非定时入库路由必须继续强制剥离 x-cron-secret，防止伪造扩散
        let non_cron_ctx = RequestContext::from_headers(
            &test_config(),
            &client_headers,
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)),
            "/api/ops/status",
        );
        let non_cron_sanitized = build_upstream_request_headers(
            &client_headers,
            &non_cron_ctx,
            &HOP_BY_HOP_HEADERS,
            false,
        )
        .expect("sanitize non-cron request headers");
        assert!(!non_cron_sanitized.contains_key("x-cron-secret"));
    }

    #[test]
    fn deduplicates_response_trace_and_request_id_headers() {
        let mut client_headers = HeaderMap::new();
        client_headers.insert("x-request-id", HeaderValue::from_static("req-unique-1"));
        client_headers.insert(
            "x-chat-trace-id",
            HeaderValue::from_static("cw-trace-unique-1"),
        );
        let ctx = RequestContext::from_headers(
            &test_config(),
            &client_headers,
            IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
            "/api/messages/send",
        );

        let mut upstream_headers = HeaderMap::new();
        upstream_headers.append("x-request-id", HeaderValue::from_static("req-unique-1"));
        upstream_headers.append(
            "x-chat-trace-id",
            HeaderValue::from_static("cw-trace-unique-1, cw-trace-unique-1"),
        );
        upstream_headers.append("x-gateway-ingress", HeaderValue::from_static("spoofed"));

        let out = build_client_response_headers(
            &upstream_headers,
            &ctx,
            Some(RateLimitDecision {
                allowed: true,
                remaining: 99,
                retry_after_secs: 0,
            }),
            &HOP_BY_HOP_HEADERS,
            false,
        )
        .expect("build response headers");

        assert_eq!(out.get_all("x-request-id").iter().count(), 1);
        assert_eq!(
            out.get("x-request-id").and_then(|v| v.to_str().ok()),
            Some("req-unique-1")
        );
        assert_eq!(out.get_all("x-chat-trace-id").iter().count(), 1);
        assert_eq!(
            out.get("x-chat-trace-id").and_then(|v| v.to_str().ok()),
            Some("cw-trace-unique-1")
        );
        assert_eq!(out.get_all("x-gateway-ingress").iter().count(), 1);
        assert_eq!(
            out.get("x-gateway-ingress").and_then(|v| v.to_str().ok()),
            Some("rust")
        );
    }

    #[test]
    fn detects_and_preserves_websocket_upgrade_headers() {
        let mut headers = HeaderMap::new();
        headers.insert(header::CONNECTION, HeaderValue::from_static("Upgrade"));
        headers.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
        headers.insert(
            "sec-websocket-key",
            HeaderValue::from_static("dGhlIHNhbXBsZSBub25jZQ=="),
        );
        assert!(is_websocket_upgrade_request(&headers));

        let ctx = RequestContext::from_headers(
            &test_config(),
            &headers,
            IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
            "/socket.io/",
        );
        let upstream = build_upstream_request_headers(&headers, &ctx, &HOP_BY_HOP_HEADERS, true)
            .expect("ws headers");
        assert_eq!(
            upstream
                .get(header::CONNECTION)
                .and_then(|v| v.to_str().ok()),
            Some("Upgrade")
        );
        assert_eq!(
            upstream.get(header::UPGRADE).and_then(|v| v.to_str().ok()),
            Some("websocket")
        );
        assert!(upstream.contains_key("sec-websocket-key"));
    }
}
