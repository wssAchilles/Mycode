#[cfg(not(target_env = "msvc"))]
#[global_allocator]
static GLOBAL: tikv_jemallocator::Jemalloc = tikv_jemallocator::Jemalloc;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result};
use telegram_rust_gateway::{
    bootstrap::{mark_gateway_online, seed_control_plane},
    build_router,
    config::GatewayConfig,
    control_plane,
    fanout_bridge::FanoutBridge,
    ingress_audit::IngressAuditTrail,
    jwt, perf_fixture,
    presence_router::PresenceRouter,
    probes::{prime_dependency_probes, spawn_dependency_probe_loop},
    rate_limit::RateLimiter,
    realtime::{
        fanout::delivery_consumer::spawn_delivery_consumer_loop,
        socket::server::{create_socket_layer, register_socket_namespace},
        state::{redis_session_registry::RedisSessionRegistry, SessionRegistryBackend},
    },
    realtime_consumer::spawn_realtime_consumer_loop,
    realtime_ops::RealtimeOpsState,
    session_registry::RealtimeSessionRegistry,
    state::AppState,
};
use tokio::{net::TcpListener, signal};
use tracing::info;

#[tokio::main]
async fn main() -> Result<()> {
    if std::env::args().any(|arg| arg == "--perf-fixture") {
        return perf_fixture::run();
    }

    init_tracing();

    let config = GatewayConfig::from_env()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(config.request_timeout_secs))
        .build()
        .context("failed to build reqwest client")?;

    let control_plane = Arc::new(Mutex::new(control_plane::RuntimeControlPlane::new()));
    {
        let mut plane = control_plane.lock().expect("control plane mutex poisoned");
        seed_control_plane(&mut plane, &config);
    }

    let (socket_layer, socket_io) = if config.realtime_socket_terminator_owner() == "rust" {
        let (layer, io) = create_socket_layer();
        (Some(layer), Some(io))
    } else {
        (None, None)
    };

    let session_registry = match std::env::var("REDIS_URL") {
        Ok(url) if !url.is_empty() => match redis::Client::open(url.as_str()) {
            Ok(c) => {
                let gid = std::env::var("GATEWAY_ID").unwrap_or_else(|_| "gateway-1".into());
                info!("using Redis session registry (gateway_id={})", gid);
                SessionRegistryBackend::Redis(RedisSessionRegistry::new(
                    c,
                    gid,
                    config.realtime_session_lease_ttl_secs,
                ))
            }
            Err(e) => {
                tracing::warn!("Redis connect failed: {}, falling back to in-memory", e);
                SessionRegistryBackend::InMemory(Arc::new(tokio::sync::Mutex::new(
                    RealtimeSessionRegistry::default(),
                )))
            }
        },
        _ => {
            info!("using in-memory session registry");
            SessionRegistryBackend::InMemory(Arc::new(tokio::sync::Mutex::new(
                RealtimeSessionRegistry::default(),
            )))
        }
    };

    let state = AppState {
        jwt_validator: config.jwt_secret.as_deref().map(jwt::JwtPrevalidator::new),
        limiter: RateLimiter::new(config.rate_limit_capacity, config.rate_limit_refill_per_sec),
        client,
        control_plane,
        ingress_audit: Arc::new(Mutex::new(IngressAuditTrail::new())),
        session_registry,
        realtime_presence: Arc::new(Mutex::new(PresenceRouter::default())),
        realtime_ops: Arc::new(Mutex::new(RealtimeOpsState::default())),
        realtime_fanout_bridge: Arc::new(Mutex::new(FanoutBridge::default())),
        realtime_socket_state: Arc::new(Mutex::new(
            telegram_rust_gateway::realtime::socket::state::RustSocketSessionStore::default(),
        )),
        realtime_socket_io: socket_io.clone(),
        config,
    };

    if let Some(io) = socket_io.as_ref() {
        register_socket_namespace(io, state.clone());
    }

    prime_dependency_probes(&state).await;
    spawn_dependency_probe_loop(state.clone());
    spawn_realtime_consumer_loop(state.clone());
    spawn_delivery_consumer_loop(state.clone());

    let app = build_router(state.clone(), socket_layer);
    let listener = TcpListener::bind(state.config.bind_addr)
        .await
        .with_context(|| format!("failed to bind {}", state.config.bind_addr))?;

    mark_gateway_online(&state);
    info!(bind_addr = %state.config.bind_addr, upstream = %state.config.upstream_http, "rust gateway ready");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
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
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}
