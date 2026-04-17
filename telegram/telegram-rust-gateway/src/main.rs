mod auth;
mod config;
mod core;
mod http;
mod ingress;
mod ops;
mod realtime;

pub use auth::jwt;
pub use core::{bootstrap, state};
pub use http::{cors, error, handlers, probes};
pub use ingress::{ingress_audit, ingress_commands, rate_limit, request_context, traffic_policy};
pub use ops::{control_plane, realtime_ops};
pub use realtime::{
    fanout_bridge, presence_router, realtime_auth, realtime_consumer, realtime_contracts,
    session_registry,
};

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{Context, Result};
use axum::{
    Router,
    middleware::from_fn_with_state,
    routing::{any, get},
};
use bootstrap::{mark_gateway_online, seed_control_plane};
use config::GatewayConfig;
use fanout_bridge::FanoutBridge;
use ingress_audit::IngressAuditTrail;
use presence_router::PresenceRouter;
use probes::{prime_dependency_probes, spawn_dependency_probe_loop};
use rate_limit::RateLimiter;
use realtime::fanout::delivery_consumer::spawn_delivery_consumer_loop;
use realtime_consumer::spawn_realtime_consumer_loop;
use realtime_ops::RealtimeOpsState;
use session_registry::RealtimeSessionRegistry;
use state::AppState;
use tokio::{net::TcpListener, signal};
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let config = GatewayConfig::from_env()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(config.request_timeout_secs))
        .build()
        .context("failed to build reqwest client")?;

    let control_plane = Arc::new(Mutex::new(control_plane::RuntimeControlPlane::new()));
    {
        let mut plane = control_plane.lock().expect("control plane mutex poisoned");
        seed_control_plane(&mut plane);
    }

    let state = AppState {
        jwt_validator: config.jwt_secret.as_deref().map(jwt::JwtPrevalidator::new),
        limiter: RateLimiter::new(config.rate_limit_capacity, config.rate_limit_refill_per_sec),
        client,
        control_plane,
        ingress_audit: Arc::new(Mutex::new(IngressAuditTrail::new())),
        realtime_registry: Arc::new(Mutex::new(RealtimeSessionRegistry::default())),
        realtime_presence: Arc::new(Mutex::new(PresenceRouter::default())),
        realtime_ops: Arc::new(Mutex::new(RealtimeOpsState::default())),
        realtime_fanout_bridge: Arc::new(Mutex::new(FanoutBridge::default())),
        config,
    };

    prime_dependency_probes(&state).await;
    spawn_dependency_probe_loop(state.clone());
    spawn_realtime_consumer_loop(state.clone());
    spawn_delivery_consumer_loop(state.clone());

    let app = build_router(state.clone());
    let listener = TcpListener::bind(state.config.bind_addr)
        .await
        .with_context(|| format!("failed to bind {}", state.config.bind_addr))?;

    mark_gateway_online(&state);

    info!(
        bind_addr = %state.config.bind_addr,
        upstream = %state.config.upstream_http,
        "rust gateway ready"
    );

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .context("gateway server error")
}

fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(handlers::health_handler))
        .route(
            "/gateway/ops/control-plane",
            get(handlers::control_plane_handler),
        )
        .route(
            "/gateway/ops/control-plane/summary",
            get(handlers::control_plane_summary_handler),
        )
        .route(
            "/gateway/ops/ingress-policy",
            get(handlers::ingress_policy_handler),
        )
        .route(
            "/gateway/ops/traffic",
            get(handlers::ingress_traffic_handler),
        )
        .route("/gateway/ops/realtime", get(handlers::realtime_ops_handler))
        .route(
            "/gateway/ops/realtime/summary",
            get(handlers::realtime_summary_handler),
        )
        .route("/", any(handlers::proxy_handler))
        .route("/{*path}", any(handlers::proxy_handler))
        .layer(from_fn_with_state(state.clone(), cors::cors_middleware))
        .with_state(state)
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
