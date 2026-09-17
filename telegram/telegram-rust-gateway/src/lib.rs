pub mod auth;
pub mod config;
pub mod core;
pub mod http;
pub mod ingress;
pub mod ops;
pub mod perf_fixture;
pub mod realtime;

pub use auth::jwt;
pub use core::{bootstrap, state};
pub use http::{cors, error, handlers, probes};
pub use ingress::{ingress_audit, ingress_commands, rate_limit, request_context, traffic_policy};
pub use ops::{control_plane, realtime_ops};
pub use realtime::{
    fanout_bridge, presence_router, realtime_auth, realtime_consumer, realtime_contracts,
    session_registry,
};

use axum::{
    Router,
    middleware::from_fn_with_state,
    routing::{any, get},
};
use socketioxide::layer::SocketIoLayer;
use state::AppState;

pub fn build_router(state: AppState, socket_layer: Option<SocketIoLayer>) -> Router {
    let router = Router::new()
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
        .with_state(state.clone());

    let router = if let Some(layer) = socket_layer {
        router.layer(layer)
    } else {
        router
    };
    router.layer(from_fn_with_state(state, cors::cors_middleware))
}
