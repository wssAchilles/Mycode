use std::net::IpAddr;

use axum::http::HeaderMap;
use uuid::Uuid;

use crate::{config::GatewayConfig, traffic_policy::TrafficClass};

#[derive(Debug, Clone)]
pub struct RequestContext {
    pub request_id: String,
    pub chat_trace_id: Option<String>,
    pub client_ip: IpAddr,
    pub forwarded_for: String,
    pub route_class: TrafficClass,
    pub request_timeout_secs: u64,
    pub rate_limit_bypassed: bool,
    pub jwt_prevalidation_bypassed: bool,
}

impl RequestContext {
    pub fn from_headers(
        config: &GatewayConfig,
        headers: &HeaderMap,
        socket_ip: IpAddr,
        path: &str,
    ) -> Self {
        let route_class = TrafficClass::from_path(path);
        let client_ip = resolve_client_ip(config, headers, socket_ip);
        let forwarded_for = resolve_forwarded_for(headers, client_ip);

        Self {
            request_id: pick_header(headers, "x-request-id")
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
            chat_trace_id: pick_header(headers, "x-chat-trace-id"),
            client_ip,
            forwarded_for,
            route_class,
            request_timeout_secs: route_class.request_timeout_secs(
                config.request_timeout_secs,
                config.sync_request_timeout_secs,
            ),
            rate_limit_bypassed: route_class.bypass_rate_limit(),
            jwt_prevalidation_bypassed: route_class.bypass_jwt_prevalidation(),
        }
    }
}

fn pick_header(headers: &HeaderMap, key: &str) -> Option<String> {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn resolve_client_ip(config: &GatewayConfig, headers: &HeaderMap, socket_ip: IpAddr) -> IpAddr {
    if config.trust_x_forwarded_for {
        if let Some(value) = pick_header(headers, "x-forwarded-for") {
            if let Some(first) = value.split(',').next() {
                if let Ok(ip) = first.trim().parse::<IpAddr>() {
                    return ip;
                }
            }
        }

        if let Some(value) = pick_header(headers, "x-real-ip") {
            if let Ok(ip) = value.parse::<IpAddr>() {
                return ip;
            }
        }
    }

    socket_ip
}

fn resolve_forwarded_for(headers: &HeaderMap, client_ip: IpAddr) -> String {
    pick_header(headers, "x-forwarded-for").unwrap_or_else(|| client_ip.to_string())
}

#[cfg(test)]
mod tests {
    use std::net::{IpAddr, Ipv4Addr, SocketAddr};

    use axum::http::{HeaderMap, HeaderValue};

    use super::RequestContext;
    use crate::config::GatewayConfig;

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
        }
    }

    #[test]
    fn preserves_existing_request_context_headers() {
        let mut headers = HeaderMap::new();
        headers.insert("x-request-id", HeaderValue::from_static("req-123"));
        headers.insert("x-chat-trace-id", HeaderValue::from_static("trace-456"));
        headers.insert(
            "x-forwarded-for",
            HeaderValue::from_static("203.0.113.7, 10.0.0.2"),
        );

        let context = RequestContext::from_headers(
            &config(),
            &headers,
            IpAddr::V4(Ipv4Addr::new(10, 0, 0, 9)),
            "/api/sync/updates",
        );

        assert_eq!(context.request_id, "req-123");
        assert_eq!(context.chat_trace_id.as_deref(), Some("trace-456"));
        assert_eq!(context.client_ip, IpAddr::V4(Ipv4Addr::new(203, 0, 113, 7)));
        assert_eq!(context.forwarded_for, "203.0.113.7, 10.0.0.2");
        assert_eq!(context.request_timeout_secs, 45);
        assert!(!context.jwt_prevalidation_bypassed);
    }

    #[test]
    fn generates_request_id_when_missing() {
        let headers = HeaderMap::new();
        let context = RequestContext::from_headers(
            &config(),
            &headers,
            IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)),
            "/api/messages/chat/room-1",
        );

        assert!(!context.request_id.is_empty());
        assert_eq!(context.client_ip, IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)));
        assert_eq!(context.forwarded_for, "127.0.0.1");
        assert!(!context.rate_limit_bypassed);
        assert!(!context.jwt_prevalidation_bypassed);
    }
}
