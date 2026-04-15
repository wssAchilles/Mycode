use axum::{
    body::Body,
    extract::{Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header},
    middleware::Next,
    response::Response,
};

use crate::state::AppState;

const ALLOW_METHODS: &str = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const ALLOW_HEADERS: &str =
    "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Request-Id, X-Chat-Trace-Id, X-Chat-Worker-Build, X-Chat-Runtime-Profile, X-Ops-Token";
const EXPOSE_HEADERS: &str =
    "X-Request-Id, X-Chat-Trace-Id, X-Gateway-Ingress, X-Gateway-Route-Class, X-Gateway-Request-Timeout-Secs, X-RateLimit-Remaining, Retry-After";

pub async fn cors_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    let origin = request_origin(request.headers(), &state);

    if request.method() == Method::OPTIONS {
        return preflight_response(origin.as_deref());
    }

    let mut response = next.run(request).await;
    apply_cors_headers(response.headers_mut(), origin.as_deref());
    response
}

fn request_origin(headers: &HeaderMap, state: &AppState) -> Option<String> {
    headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .filter(|origin| state.config.is_origin_allowed(origin))
        .map(str::to_owned)
}

fn preflight_response(origin: Option<&str>) -> Response {
    let mut response = Response::builder()
        .status(StatusCode::NO_CONTENT)
        .body(Body::empty())
        .expect("preflight response");
    apply_cors_headers(response.headers_mut(), origin);
    response
}

fn apply_cors_headers(headers: &mut HeaderMap, origin: Option<&str>) {
    let Some(origin) = origin else {
        return;
    };

    if let Ok(origin_value) = HeaderValue::from_str(origin) {
        headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, origin_value);
        headers.insert(header::VARY, HeaderValue::from_static("Origin"));
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
            HeaderValue::from_static("true"),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_METHODS,
            HeaderValue::from_static(ALLOW_METHODS),
        );
        headers.insert(
            header::ACCESS_CONTROL_ALLOW_HEADERS,
            HeaderValue::from_static(ALLOW_HEADERS),
        );
        headers.insert(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            HeaderValue::from_static(EXPOSE_HEADERS),
        );
    }
}

#[cfg(test)]
mod tests {
    use std::net::{Ipv4Addr, SocketAddr};

    use axum::http::{HeaderMap, HeaderValue};

    use super::{apply_cors_headers, request_origin};
    use crate::{
        config::GatewayConfig,
        ingress_audit::IngressAuditTrail,
        rate_limit::RateLimiter,
        state::AppState,
    };
    use std::sync::{Arc, Mutex};

    fn state() -> AppState {
        AppState {
            config: GatewayConfig {
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
                cors_extra_origins: vec!["https://custom.example.com".to_string()],
            },
            client: reqwest::Client::new(),
            limiter: RateLimiter::new(120.0, 2.0),
            control_plane: Arc::new(Mutex::new(crate::control_plane::RuntimeControlPlane::new())),
            ingress_audit: Arc::new(Mutex::new(IngressAuditTrail::new())),
            jwt_validator: None,
        }
    }

    #[test]
    fn resolves_allowed_request_origin() {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::ORIGIN,
            HeaderValue::from_static("https://telegram-467705.web.app"),
        );
        assert_eq!(
            request_origin(&headers, &state()).as_deref(),
            Some("https://telegram-467705.web.app")
        );

        headers.insert(
            axum::http::header::ORIGIN,
            HeaderValue::from_static("https://evil.example.com"),
        );
        assert!(request_origin(&headers, &state()).is_none());
    }

    #[test]
    fn decorates_response_headers_for_allowed_origin() {
        let mut headers = HeaderMap::new();
        apply_cors_headers(&mut headers, Some("https://telegram-467705.web.app"));

        assert_eq!(
            headers
                .get(axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .and_then(|value| value.to_str().ok()),
            Some("https://telegram-467705.web.app")
        );
        assert_eq!(
            headers
                .get(axum::http::header::ACCESS_CONTROL_ALLOW_CREDENTIALS)
                .and_then(|value| value.to_str().ok()),
            Some("true")
        );
        let allow_headers = headers
            .get(axum::http::header::ACCESS_CONTROL_ALLOW_HEADERS)
            .and_then(|value| value.to_str().ok())
            .expect("allow headers should be set");
        assert!(allow_headers.contains("X-Chat-Worker-Build"));
        assert!(allow_headers.contains("X-Chat-Runtime-Profile"));
    }
}
