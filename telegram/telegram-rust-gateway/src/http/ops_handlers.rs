use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::json;
use tracing::error;

use crate::{
    error::GatewayError,
    probes::{control_plane_snapshot, probe_upstream},
    realtime_contracts::{GatewayRealtimeOpsResponse, GatewayRealtimeSummaryResponse},
    state::{
        AppState, GatewayStatusPayload, HealthResponse, SummaryPayload, UpstreamHealthPayload,
    },
    traffic_policy::policy_catalog,
};

use super::ops_auth::verify_ops_token;
use super::proxy_support::{
    ingress_audit_snapshot, realtime_runtime_contract, realtime_transport_catalog_contract,
    rollout_stage_contract, rollout_stage_label,
};

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

pub async fn ingress_policy_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, GatewayError> {
    verify_ops_token(&state, &headers)?;
    Ok(Json(policy_catalog(
        state.config.request_timeout_secs,
        state.config.sync_request_timeout_secs,
    )))
}

pub async fn ingress_traffic_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, GatewayError> {
    verify_ops_token(&state, &headers)?;
    Ok(Json(ingress_audit_snapshot(&state)))
}

pub async fn realtime_ops_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, GatewayError> {
    verify_ops_token(&state, &headers)?;
    let registry_snapshot = state
        .realtime_registry
        .lock()
        .expect("realtime registry mutex poisoned")
        .snapshot(state.config.realtime_heartbeat_stale_secs);
    let presence_snapshot = state
        .realtime_presence
        .lock()
        .expect("realtime presence mutex poisoned")
        .snapshot();
    let ops_snapshot = state
        .realtime_ops
        .lock()
        .expect("realtime ops mutex poisoned")
        .snapshot();
    let fanout_bridge = state
        .realtime_fanout_bridge
        .lock()
        .expect("realtime fanout bridge mutex poisoned")
        .snapshot();
    let runtime = realtime_runtime_contract(&state.config);
    let transport = realtime_transport_catalog_contract(&state.config);

    Ok(Json(GatewayRealtimeOpsResponse {
        mode: rollout_stage_label(state.config.realtime_rollout_stage).to_string(),
        current_stage: rollout_stage_contract(state.config.realtime_rollout_stage),
        runtime,
        transport,
        session_count: registry_snapshot.totals.connected_sessions,
        authenticated_session_count: registry_snapshot.totals.authenticated_sessions,
        subscription_count: registry_snapshot.totals.room_subscriptions,
        presence_state_counts: presence_snapshot.state_counts,
        ingress_stream_lag: ops_snapshot.ingress_stream_lag,
        delivery_stream_lag: ops_snapshot.delivery_stream_lag,
        drop_reasons: ops_snapshot.drop_reasons,
        delivery_drop_reasons: ops_snapshot.delivery_drop_reasons,
        auth_failures: ops_snapshot.auth_failures,
        compat_hits: ops_snapshot.compat_hits,
        fallback_hits: ops_snapshot.fallback_hits,
        delivery_counts_by_topic: ops_snapshot.delivery_counts_by_topic,
        delivery_counts_by_target: ops_snapshot.delivery_counts_by_target,
        last_event_at: ops_snapshot.last_event_at,
        last_delivery_at: ops_snapshot.last_delivery_at,
        consumer_group: state.config.realtime_consumer_group.clone(),
        consumer_name: state.config.realtime_consumer_name.clone(),
        delivery_consumer_group: state.config.realtime_delivery_consumer_group.clone(),
        delivery_consumer_name: state.config.realtime_delivery_consumer_name.clone(),
        registry: json!(registry_snapshot),
        fanout_bridge: json!(fanout_bridge),
        recent_events: ops_snapshot.recent_events,
        recent_deliveries: ops_snapshot.recent_deliveries,
    }))
}

pub async fn realtime_summary_handler(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, GatewayError> {
    verify_ops_token(&state, &headers)?;
    let snapshot = control_plane_snapshot(&state);
    let recommended_action = snapshot
        .recommendations
        .first()
        .map(|entry| format!("{:?} on {}", entry.action, entry.unit).to_lowercase())
        .unwrap_or_else(|| "continue monitoring".to_string());
    let current_blocker = snapshot.current_blocker.map(|entry| entry.reason);
    let runtime = realtime_runtime_contract(&state.config);
    let transport = realtime_transport_catalog_contract(&state.config);

    Ok(Json(GatewayRealtimeSummaryResponse {
        status: format!("{:?}", snapshot.overall_status).to_lowercase(),
        current_stage: rollout_stage_contract(state.config.realtime_rollout_stage),
        runtime,
        transport,
        current_blocker,
        recommended_action,
        summary: snapshot.summary,
    }))
}
