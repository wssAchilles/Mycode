use std::net::SocketAddr;

use anyhow::Context;
use tokio::net::TcpListener;
use tracing::info;

use telegram_rust_recommendation::config::RecommendationConfig;
use telegram_rust_recommendation::perf_fixture;
use telegram_rust_recommendation::server::app::{build_app_state, build_router};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    if std::env::args().any(|arg| arg == "--perf-fixture") {
        return perf_fixture::run().await;
    }

    tracing_subscriber::fmt::init();

    let config = RecommendationConfig::from_env()?;
    let app = build_router(build_app_state(config.clone())?);

    let bind_addr: SocketAddr = config
        .bind_addr
        .parse()
        .with_context(|| format!("parse bind addr {}", config.bind_addr))?;
    let listener = TcpListener::bind(bind_addr)
        .await
        .with_context(|| format!("bind rust recommendation service {}", config.bind_addr))?;

    info!(
        bind_addr = %config.bind_addr,
        stage = %config.stage,
        "rust recommendation service listening"
    );

    axum::serve(listener, app)
        .await
        .context("serve rust recommendation axum app")?;
    Ok(())
}
