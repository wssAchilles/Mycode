use crate::{
    config::{GatewayConfig, GatewayRealtimeSocketTerminator},
    control_plane::{
        LifecyclePhase, LifecycleStatus, MarkUnitInput, RecoveryAction, RuntimeControlPlane,
    },
    state::AppState,
};

pub fn seed_control_plane(plane: &mut RuntimeControlPlane, config: &GatewayConfig) {
    let socket_boundary_compat_mode = matches!(
        config.realtime_socket_terminator,
        GatewayRealtimeSocketTerminator::Node
    );
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
        unit: "gateway_ingress_audit",
        phase: LifecyclePhase::DependencyBootstrap,
        status: LifecycleStatus::Ready,
        critical: Some(false),
        compat_mode: Some(false),
        retries: Some(0),
        recovery_action: Some(RecoveryAction::Noop),
        failure_class: None,
        message: Some("typed ingress audit trail ready".to_string()),
    });
    plane.mark_unit(MarkUnitInput {
        unit: "socket_io_compat_boundary",
        phase: LifecyclePhase::DependencyBootstrap,
        status: LifecycleStatus::Spawning,
        critical: Some(false),
        compat_mode: Some(socket_boundary_compat_mode),
        retries: Some(0),
        recovery_action: Some(RecoveryAction::RetryOnce),
        failure_class: None,
        message: Some(match config.realtime_socket_terminator {
            GatewayRealtimeSocketTerminator::Rust => {
                "waiting for selected socket.io compat probe (socketTerminator=rust)".to_string()
            }
            GatewayRealtimeSocketTerminator::Node => {
                "waiting for selected socket.io compat probe (socketTerminator=node)".to_string()
            }
        }),
    });
    plane.mark_unit(MarkUnitInput {
        unit: "realtime_protocol_boundary",
        phase: LifecyclePhase::DependencyBootstrap,
        status: LifecycleStatus::Spawning,
        critical: Some(false),
        compat_mode: Some(false),
        retries: Some(0),
        recovery_action: Some(RecoveryAction::RetryOnce),
        failure_class: None,
        message: Some("waiting for realtime protocol probe".to_string()),
    });
    plane.mark_unit(MarkUnitInput {
        unit: "realtime_stream_boundary",
        phase: LifecyclePhase::WorkerBoot,
        status: LifecycleStatus::Spawning,
        critical: Some(false),
        compat_mode: Some(true),
        retries: Some(0),
        recovery_action: Some(RecoveryAction::DegradeToCompat),
        failure_class: None,
        message: Some("waiting for realtime ingress consumer bootstrap".to_string()),
    });
    plane.mark_unit(MarkUnitInput {
        unit: "realtime_delivery_boundary",
        phase: LifecyclePhase::WorkerBoot,
        status: LifecycleStatus::Spawning,
        critical: Some(false),
        compat_mode: Some(true),
        retries: Some(0),
        recovery_action: Some(RecoveryAction::DegradeToCompat),
        failure_class: None,
        message: Some("waiting for realtime delivery consumer bootstrap".to_string()),
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

pub fn mark_gateway_online(state: &AppState) {
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
        message: Some(format!(
            "rust ingress gateway online (fanoutOwner={}, socketTerminator={})",
            state.config.realtime_fanout_owner(),
            state.config.realtime_socket_terminator_owner(),
        )),
    });
}
