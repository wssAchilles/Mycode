use std::{
    net::{IpAddr, SocketAddr},
    time::Duration,
};

use axum::{
    body::Body,
    extract::{ConnectInfo, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures_util::TryStreamExt;
use tracing::{error, warn};

use crate::{
    error::GatewayError,
    probes::{control_plane_snapshot, mark_proxy_failure, mark_proxy_recovery, probe_upstream},
    state::{
        AppState, GatewayStatusPayload, HealthResponse, SummaryPayload, UpstreamHealthPayload,
    },
    traffic_policy::TrafficClass,
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

pub async fn proxy_handler(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    request: Request,
) -> Result<Response, GatewayError> {
    let client_ip = client_ip(&state, &request.headers(), addr.ip());
    let route_class = TrafficClass::from_path(request.uri().path());
    let decision = if route_class.bypass_rate_limit() {
        None
    } else {
        let decision = state.limiter.check(&route_class.bucket_key(&client_ip));
        if !decision.allowed {
            warn!(
                client_ip = %client_ip,
                route_class = %route_class,
                retry_after_secs = decision.retry_after_secs,
                "gateway rate limit hit"
            );
            return Err(GatewayError::RateLimited {
                retry_after_secs: decision.retry_after_secs,
            });
        }
        Some(decision)
    };

    if state.config.validate_access_tokens && !route_class.bypass_jwt_prevalidation() {
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

    let request_timeout_secs = route_class.request_timeout_secs(
        state.config.request_timeout_secs,
        state.config.sync_request_timeout_secs,
    );
    let mut builder = state
        .client
        .request(method.clone(), upstream_url)
        .timeout(Duration::from_secs(request_timeout_secs));
    builder = copy_request_headers(builder, &request_headers, &client_ip);
    let body_stream =
        futures_util::TryStreamExt::map_err(request.into_body().into_data_stream(), |err| {
            std::io::Error::other(err.to_string())
        });
    let upstream_response = builder
        .body(reqwest::Body::wrap_stream(body_stream))
        .send()
        .await
        .map_err(|err| {
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
        .header("x-gateway-route-class", route_class.as_str());
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

    response_builder
        .body(Body::from_stream(stream))
        .map_err(|_| GatewayError::Internal)
}

fn copy_request_headers(
    mut builder: reqwest::RequestBuilder,
    headers: &HeaderMap,
    client_ip: &IpAddr,
) -> reqwest::RequestBuilder {
    for (name, value) in headers.iter() {
        if name == header::HOST || is_hop_by_hop(name) {
            continue;
        }
        builder = builder.header(name, value);
    }

    builder
        .header("x-forwarded-for", client_ip.to_string())
        .header("x-gateway-ingress", "rust")
}

fn client_ip(state: &AppState, headers: &HeaderMap, socket_ip: IpAddr) -> IpAddr {
    if state.config.trust_x_forwarded_for {
        if let Some(header) = headers.get("x-forwarded-for") {
            if let Ok(value) = header.to_str() {
                if let Some(first) = value.split(',').next() {
                    if let Ok(ip) = first.trim().parse::<IpAddr>() {
                        return ip;
                    }
                }
            }
        }
        if let Some(header) = headers.get("x-real-ip") {
            if let Ok(value) = header.to_str() {
                if let Ok(ip) = value.trim().parse::<IpAddr>() {
                    return ip;
                }
            }
        }
    }
    socket_ip
}

fn is_hop_by_hop(name: &HeaderName) -> bool {
    HOP_BY_HOP_HEADERS
        .iter()
        .any(|header_name| name.as_str().eq_ignore_ascii_case(header_name))
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
