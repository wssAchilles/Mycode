mod config;
mod control_plane;
mod error;
mod jwt;
mod rate_limit;

use std::{
    net::{IpAddr, SocketAddr},
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{Context, Result};
use axum::{
    Router,
    body::Body,
    extract::{ConnectInfo, Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{any, get},
};
use config::GatewayConfig;
use control_plane::{
    ControlPlaneSnapshot, FailureClass, LifecyclePhase, LifecycleStatus, MarkUnitInput,
    RecoveryAction, RuntimeControlPlane,
};
use error::GatewayError;
use futures_util::TryStreamExt;
use jwt::JwtPrevalidator;
use rate_limit::RateLimiter;
use reqwest::Client;
use serde::Serialize;
use tokio::{net::TcpListener, signal, time::interval};
use tracing::{error, info, warn};

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

#[derive(Clone)]
struct AppState {
    config: GatewayConfig,
    client: Client,
    limiter: RateLimiter,
    control_plane: Arc<Mutex<RuntimeControlPlane>>,
    jwt_validator: Option<JwtPrevalidator>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    ok: bool,
    gateway: GatewayStatusPayload,
    upstream: UpstreamHealthPayload,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayStatusPayload {
    overall_status: LifecycleStatus,
    summary: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpstreamHealthPayload {
    reachable: bool,
    status_code: Option<u16>,
    detail: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SummaryPayload {
    summary: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let config = GatewayConfig::from_env()?;
    let client = Client::builder()
        .timeout(Duration::from_secs(config.request_timeout_secs))
        .build()
        .context("failed to build reqwest client")?;

    let control_plane = Arc::new(Mutex::new(RuntimeControlPlane::new()));
    {
        let mut plane = control_plane.lock().expect("control plane mutex poisoned");
        plane.mark_unit(MarkUnitInput {
            unit: "gateway_config",
            phase: LifecyclePhase::ConfigLoad,
            status: LifecycleStatus::Ready,
            critical: Some(true),
            compat_mode: Some(false),
            retries: Some(0),
            recovery_action: Some(RecoveryAction::Noop),
            failure_class: None,
            message: Some("gateway configuration loaded".to_string()),
        });
        plane.mark_unit(MarkUnitInput {
            unit: "gateway_rate_limiter",
            phase: LifecyclePhase::DependencyBootstrap,
            status: LifecycleStatus::Ready,
            critical: Some(false),
            compat_mode: Some(false),
            retries: Some(0),
            recovery_action: Some(RecoveryAction::Noop),
            failure_class: None,
            message: Some("token bucket limiter ready".to_string()),
        });
        plane.mark_unit(MarkUnitInput {
            unit: "socket_io_compat_boundary",
            phase: LifecyclePhase::Runtime,
            status: LifecycleStatus::Degraded,
            critical: Some(false),
            compat_mode: Some(true),
            retries: Some(0),
            recovery_action: Some(RecoveryAction::Noop),
            failure_class: None,
            message: Some("socket.io remains on Node compatibility path".to_string()),
        });
        plane.mark_unit(MarkUnitInput {
            unit: "upstream_http",
            phase: LifecyclePhase::DependencyBootstrap,
            status: LifecycleStatus::Spawning,
            critical: Some(true),
            compat_mode: Some(false),
            retries: Some(0),
            recovery_action: Some(RecoveryAction::RetryOnce),
            failure_class: None,
            message: Some("waiting for upstream health probe".to_string()),
        });
    }

    let state = AppState {
        jwt_validator: config.jwt_secret.as_deref().map(JwtPrevalidator::new),
        limiter: RateLimiter::new(config.rate_limit_capacity, config.rate_limit_refill_per_sec),
        client,
        control_plane,
        config,
    };

    spawn_upstream_probe_loop(state.clone());

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/gateway/ops/control-plane", get(control_plane_handler))
        .route(
            "/gateway/ops/control-plane/summary",
            get(control_plane_summary_handler),
        )
        .route("/", any(proxy_handler))
        .route("/{*path}", any(proxy_handler))
        .with_state(state.clone());

    let listener = TcpListener::bind(state.config.bind_addr)
        .await
        .with_context(|| format!("failed to bind {}", state.config.bind_addr))?;

    {
        let mut plane = state
            .control_plane
            .lock()
            .expect("control plane mutex poisoned");
        plane.mark_unit(MarkUnitInput {
            unit: "gateway_http_listener",
            phase: LifecyclePhase::HttpListen,
            status: LifecycleStatus::Ready,
            critical: Some(true),
            compat_mode: Some(false),
            retries: Some(0),
            recovery_action: Some(RecoveryAction::Noop),
            failure_class: None,
            message: Some(format!("listening on {}", state.config.bind_addr)),
        });
        plane.mark_unit(MarkUnitInput {
            unit: "gateway_runtime",
            phase: LifecyclePhase::Runtime,
            status: LifecycleStatus::Running,
            critical: Some(true),
            compat_mode: Some(false),
            retries: Some(0),
            recovery_action: Some(RecoveryAction::Noop),
            failure_class: None,
            message: Some("rust ingress gateway online".to_string()),
        });
    }

    info!(bind_addr = %state.config.bind_addr, upstream = %state.config.upstream_http, "rust gateway ready");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .context("gateway server error")
}

fn init_tracing() {
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "telegram_rust_gateway=info,tower_http=info".into());
    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_target(false)
        .compact()
        .init();
}

fn spawn_upstream_probe_loop(state: AppState) {
    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(20));
        loop {
            ticker.tick().await;
            let _ = probe_upstream(&state).await;
        }
    });
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        use tokio::signal::unix::{SignalKind, signal};
        match signal(SignalKind::terminate()) {
            Ok(mut sigterm) => {
                sigterm.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

async fn health_handler(State(state): State<AppState>) -> Response {
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
            LifecycleStatus::Failed | LifecycleStatus::Blocked
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

async fn control_plane_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, GatewayError> {
    verify_ops_token(&state, &headers)?;
    Ok(axum::Json(control_plane_snapshot(&state)))
}

async fn control_plane_summary_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, GatewayError> {
    verify_ops_token(&state, &headers)?;
    let snapshot = control_plane_snapshot(&state);
    Ok(axum::Json(SummaryPayload {
        summary: snapshot.summary,
    }))
}

async fn proxy_handler(
    State(state): State<AppState>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    request: Request,
) -> Result<Response, GatewayError> {
    let client_ip = client_ip(&state, &request.headers(), addr.ip());
    let decision = state.limiter.check(&client_ip.to_string());
    if !decision.allowed {
        warn!(client_ip = %client_ip, retry_after_secs = decision.retry_after_secs, "gateway rate limit hit");
        return Err(GatewayError::RateLimited {
            retry_after_secs: decision.retry_after_secs,
        });
    }

    if state.config.validate_access_tokens {
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

    let mut builder = state.client.request(method.clone(), upstream_url);
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
            mark_upstream_failure(
                &state,
                format!("proxy {} {} failed: {err}", method, uri.path()),
            );
            GatewayError::UpstreamUnavailable
        })?;

    mark_upstream_recovery(&state, format!("proxy {} {}", method, uri.path()));

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
    response_builder = response_builder.header("x-gateway-ingress", "rust").header(
        "x-ratelimit-remaining",
        HeaderValue::from_str(&decision.remaining.to_string())
            .unwrap_or_else(|_| HeaderValue::from_static("0")),
    );

    response_builder
        .body(Body::from_stream(stream))
        .map_err(|_| GatewayError::Internal)
}

async fn probe_upstream(state: &AppState) -> Result<UpstreamHealthPayload> {
    let health_url = format!("{}/health", state.config.upstream_http);
    match state.client.get(&health_url).send().await {
        Ok(response) => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            if status.is_success() {
                let detail = if body.is_empty() {
                    "upstream healthy".to_string()
                } else {
                    truncate(&body, 180)
                };
                mark_upstream_recovery(state, detail.clone());
                Ok(UpstreamHealthPayload {
                    reachable: true,
                    status_code: Some(status.as_u16()),
                    detail,
                })
            } else {
                let detail = format!("upstream returned {}", status.as_u16());
                mark_upstream_failure(state, detail.clone());
                Ok(UpstreamHealthPayload {
                    reachable: false,
                    status_code: Some(status.as_u16()),
                    detail,
                })
            }
        }
        Err(err) => {
            let detail = format!("upstream probe error: {err}");
            mark_upstream_failure(state, detail.clone());
            Ok(UpstreamHealthPayload {
                reachable: false,
                status_code: None,
                detail,
            })
        }
    }
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

fn control_plane_snapshot(state: &AppState) -> ControlPlaneSnapshot {
    state
        .control_plane
        .lock()
        .expect("control plane mutex poisoned")
        .snapshot()
}

fn mark_upstream_failure(state: &AppState, message: String) {
    let mut plane = state
        .control_plane
        .lock()
        .expect("control plane mutex poisoned");
    plane.mark_failure(control_plane::FailureInput {
        unit: "upstream_http",
        phase: LifecyclePhase::Runtime,
        failure_class: FailureClass::DependencyRuntime,
        message,
        critical: Some(true),
        recovery_action: Some(RecoveryAction::RetryOnce),
        compat_mode: false,
        increment_retry: true,
    });
}

fn mark_upstream_recovery(state: &AppState, message: String) {
    let mut plane = state
        .control_plane
        .lock()
        .expect("control plane mutex poisoned");
    plane.record_recovery(
        "upstream_http",
        message,
        Some(LifecyclePhase::Runtime),
        Some(LifecycleStatus::Running),
        Some(false),
    );
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        value.to_string()
    } else {
        let truncated = value.chars().take(max_chars - 1).collect::<String>();
        format!("{}…", truncated.trim_end())
    }
}
