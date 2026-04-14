use std::time::Duration;

use anyhow::Result;
use tokio::time::interval;

use crate::{
    control_plane::{
        ControlPlaneSnapshot, FailureClass, LifecyclePhase, LifecycleStatus, RecoveryAction,
    },
    state::{AppState, UpstreamHealthPayload},
};

pub async fn prime_dependency_probes(state: &AppState) {
    let _ = probe_upstream(state).await;
    let _ = probe_socket_io_compat(state).await;
}

pub fn spawn_dependency_probe_loop(state: AppState) {
    tokio::spawn(async move {
        let mut ticker = interval(Duration::from_secs(20));
        loop {
            ticker.tick().await;
            let _ = probe_upstream(&state).await;
            let _ = probe_socket_io_compat(&state).await;
        }
    });
}

pub fn control_plane_snapshot(state: &AppState) -> ControlPlaneSnapshot {
    state
        .control_plane
        .lock()
        .expect("control plane mutex poisoned")
        .snapshot()
}

pub async fn probe_upstream(state: &AppState) -> Result<UpstreamHealthPayload> {
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

pub async fn probe_socket_io_compat(state: &AppState) -> Result<()> {
    let probe_url = format!(
        "{}/socket.io/?EIO=4&transport=polling",
        state.config.upstream_http
    );
    match state.client.get(&probe_url).send().await {
        Ok(response) => {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            if status.is_success() {
                let detail = if body.is_empty() {
                    "socket.io compat path healthy".to_string()
                } else {
                    format!("socket.io compat path healthy: {}", truncate(&body, 120))
                };
                mark_socket_io_compat_recovery(state, detail);
            } else {
                mark_socket_io_compat_failure(
                    state,
                    format!("socket.io compat returned {}", status.as_u16()),
                );
            }
        }
        Err(err) => {
            mark_socket_io_compat_failure(state, format!("socket.io compat probe error: {err}"));
        }
    }
    Ok(())
}

pub fn mark_proxy_failure(state: &AppState, message: String) {
    mark_upstream_failure(state, message);
}

pub fn mark_proxy_recovery(state: &AppState, message: String) {
    mark_upstream_recovery(state, message);
}

fn mark_upstream_failure(state: &AppState, message: String) {
    let mut plane = state
        .control_plane
        .lock()
        .expect("control plane mutex poisoned");
    plane.mark_failure(crate::control_plane::FailureInput {
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

fn mark_socket_io_compat_failure(state: &AppState, message: String) {
    let mut plane = state
        .control_plane
        .lock()
        .expect("control plane mutex poisoned");
    plane.mark_failure(crate::control_plane::FailureInput {
        unit: "socket_io_compat_boundary",
        phase: LifecyclePhase::Runtime,
        failure_class: FailureClass::DependencyRuntime,
        message,
        critical: Some(false),
        recovery_action: Some(RecoveryAction::RetryOnce),
        compat_mode: true,
        increment_retry: true,
    });
}

fn mark_socket_io_compat_recovery(state: &AppState, message: String) {
    let mut plane = state
        .control_plane
        .lock()
        .expect("control plane mutex poisoned");
    plane.record_recovery(
        "socket_io_compat_boundary",
        message,
        Some(LifecyclePhase::Runtime),
        Some(LifecycleStatus::Running),
        Some(true),
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
