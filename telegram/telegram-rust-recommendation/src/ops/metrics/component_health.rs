use chrono::{DateTime, Utc};
use std::collections::VecDeque;

use crate::contracts::RecommendationStagePayload;
use crate::contracts::ops::RecommendationComponentHealthWindowEntry;

use super::{CIRCUIT_FAILURE_RATE, CIRCUIT_MIN_EVENTS, COMPONENT_HEALTH_WINDOW_SECONDS};

#[derive(Debug, Clone)]
pub(super) struct ComponentHealthEvent {
    recorded_at: DateTime<Utc>,
    pub(super) component: String,
    stage: String,
    enabled: bool,
    output_count: usize,
    duration_ms: u64,
    timed_out: bool,
    error: bool,
    degraded: bool,
    error_class: Option<String>,
    disabled_reason: Option<String>,
}

pub(super) fn component_health_event(
    stage: &RecommendationStagePayload,
    recorded_at: DateTime<Utc>,
) -> ComponentHealthEvent {
    let detail = stage.detail.as_ref();
    let timed_out = stage_timed_out(stage);
    let error_class = detail
        .and_then(|detail| detail.get("errorClass"))
        .and_then(serde_json::Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| {
            detail
                .and_then(|detail| detail.get("error"))
                .and_then(serde_json::Value::as_str)
                .filter(|error| !error.trim().is_empty())
                .map(|_| "component_error".to_string())
        });
    let error = detail
        .and_then(|detail| detail.get("error"))
        .and_then(serde_json::Value::as_str)
        .is_some_and(|error| !error.trim().is_empty())
        || error_class.is_some();

    ComponentHealthEvent {
        recorded_at,
        component: stage.name.clone(),
        stage: health_stage_kind(stage),
        enabled: stage.enabled,
        output_count: stage.output_count,
        duration_ms: stage.duration_ms,
        timed_out,
        error,
        degraded: stage.enabled && (timed_out || error),
        error_class,
        disabled_reason: stage_disabled_reason(stage),
    }
}

pub(super) fn prune_component_health_events(
    events: &mut VecDeque<ComponentHealthEvent>,
    now: DateTime<Utc>,
) {
    while events.front().is_some_and(|event| {
        now.signed_duration_since(event.recorded_at).num_seconds() > COMPONENT_HEALTH_WINDOW_SECONDS
    }) {
        events.pop_front();
    }
    while events.len() > 256 {
        events.pop_front();
    }
}

pub(super) fn summarize_component_health_events(
    events: &VecDeque<ComponentHealthEvent>,
    now: DateTime<Utc>,
) -> Option<RecommendationComponentHealthWindowEntry> {
    let recent = events
        .iter()
        .filter(|event| {
            now.signed_duration_since(event.recorded_at).num_seconds()
                <= COMPONENT_HEALTH_WINDOW_SECONDS
        })
        .collect::<Vec<_>>();
    let first = recent.first()?;
    let request_count = recent.len();
    let enabled_count = recent.iter().filter(|event| event.enabled).count();
    let timeout_count = recent.iter().filter(|event| event.timed_out).count();
    let error_count = recent.iter().filter(|event| event.error).count();
    let degraded_count = recent.iter().filter(|event| event.degraded).count();
    let success_count = recent
        .iter()
        .filter(|event| event.enabled && !event.timed_out && !event.error)
        .count();
    let output_count = recent.iter().map(|event| event.output_count).sum::<usize>();
    let duration_sum = recent.iter().map(|event| event.duration_ms).sum::<u64>();
    let last = recent
        .iter()
        .max_by_key(|event| event.recorded_at)
        .copied()
        .unwrap_or(first);
    let circuit_open = component_circuit_open(
        &first.component,
        &first.stage,
        enabled_count,
        timeout_count,
        error_count,
    );

    Some(RecommendationComponentHealthWindowEntry {
        component: first.component.clone(),
        stage: first.stage.clone(),
        window_seconds: COMPONENT_HEALTH_WINDOW_SECONDS as u64,
        request_count,
        enabled_count,
        success_count,
        timeout_count,
        error_count,
        degraded_count,
        output_count,
        avg_duration_ms: duration_sum / request_count.max(1) as u64,
        last_duration_ms: last.duration_ms,
        circuit_open,
        readiness_impact: readiness_impact(&first.component, &first.stage, circuit_open),
        last_error_class: last.error_class.clone(),
        last_disabled_reason: last.disabled_reason.clone(),
    })
}

pub(super) fn is_health_tracked_stage(stage: &RecommendationStagePayload) -> bool {
    is_source_stage(stage) || stage.name.ends_with("Hydrator")
}

fn health_stage_kind(stage: &RecommendationStagePayload) -> String {
    if is_source_stage(stage) {
        "Source".to_string()
    } else if stage.name.ends_with("Hydrator") {
        "Hydrator".to_string()
    } else {
        "Component".to_string()
    }
}

fn stage_disabled_reason(stage: &RecommendationStagePayload) -> Option<String> {
    let detail = stage.detail.as_ref()?;
    detail
        .get("disabledByCircuit")
        .or_else(|| detail.get("disabledByPolicy"))
        .or_else(|| detail.get("disabledByConfig"))
        .or_else(|| detail.get("disabled"))
        .and_then(serde_json::Value::as_str)
        .map(ToOwned::to_owned)
}

fn component_circuit_open(
    component: &str,
    stage: &str,
    enabled_count: usize,
    timeout_count: usize,
    error_count: usize,
) -> bool {
    if !circuit_skip_allowed(component, stage) || enabled_count < CIRCUIT_MIN_EVENTS {
        return false;
    }
    let failures = timeout_count.saturating_add(error_count);
    failures >= CIRCUIT_MIN_EVENTS && failures as f64 / enabled_count as f64 >= CIRCUIT_FAILURE_RATE
}

fn circuit_skip_allowed(component: &str, stage: &str) -> bool {
    match stage {
        "Source" => !matches!(component, "FollowingSource" | "ColdStartSource"),
        "Hydrator" => !matches!(
            component,
            "UserStateQueryHydrator" | "ExperimentQueryHydrator"
        ),
        _ => false,
    }
}

fn readiness_impact(component: &str, stage: &str, circuit_open: bool) -> String {
    if circuit_open {
        return "degraded_skip".to_string();
    }
    if circuit_skip_allowed(component, stage) {
        "observable".to_string()
    } else {
        "critical_observe_only".to_string()
    }
}

pub(super) fn stage_timed_out(stage: &crate::contracts::RecommendationStagePayload) -> bool {
    let Some(detail) = stage.detail.as_ref() else {
        return false;
    };

    let timed_out = detail
        .get("timedOut")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let error_is_timeout = detail
        .get("error")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|error| error.starts_with("source_timeout"));
    let error_class_is_timeout = detail
        .get("errorClass")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|error_class| error_class == "source_timeout");

    timed_out || error_is_timeout || error_class_is_timeout
}

pub(super) fn is_source_stage(stage: &RecommendationStagePayload) -> bool {
    stage.name.ends_with("Source")
        && stage.name != "RecentStoreSideEffect"
        && stage.name != "ServeCacheWriteSideEffect"
}

#[cfg(test)]
mod component_health_tests {
    use super::*;

    #[test]
    fn component_health_window_opens_circuit_for_repeat_source_failures() {
        let now = Utc::now();
        let events = VecDeque::from(vec![
            ComponentHealthEvent {
                recorded_at: now,
                component: "NewsAnnSource".to_string(),
                stage: "Source".to_string(),
                enabled: true,
                output_count: 0,
                duration_ms: 1_200,
                timed_out: true,
                error: true,
                degraded: true,
                error_class: Some("source_timeout".to_string()),
                disabled_reason: None,
            },
            ComponentHealthEvent {
                recorded_at: now,
                component: "NewsAnnSource".to_string(),
                stage: "Source".to_string(),
                enabled: true,
                output_count: 0,
                duration_ms: 1_180,
                timed_out: true,
                error: true,
                degraded: true,
                error_class: Some("source_timeout".to_string()),
                disabled_reason: None,
            },
        ]);

        let summary = summarize_component_health_events(&events, now).expect("summary");

        assert!(summary.circuit_open);
        assert_eq!(summary.readiness_impact, "degraded_skip");
        assert_eq!(summary.timeout_count, 2);
    }

    #[test]
    fn component_health_window_keeps_critical_sources_observe_only() {
        let now = Utc::now();
        let events = VecDeque::from(vec![
            ComponentHealthEvent {
                recorded_at: now,
                component: "FollowingSource".to_string(),
                stage: "Source".to_string(),
                enabled: true,
                output_count: 0,
                duration_ms: 1_200,
                timed_out: true,
                error: true,
                degraded: true,
                error_class: Some("source_timeout".to_string()),
                disabled_reason: None,
            },
            ComponentHealthEvent {
                recorded_at: now,
                component: "FollowingSource".to_string(),
                stage: "Source".to_string(),
                enabled: true,
                output_count: 0,
                duration_ms: 1_180,
                timed_out: true,
                error: true,
                degraded: true,
                error_class: Some("source_timeout".to_string()),
                disabled_reason: None,
            },
        ]);

        let summary = summarize_component_health_events(&events, now).expect("summary");

        assert!(!summary.circuit_open);
        assert_eq!(summary.readiness_impact, "critical_observe_only");
    }
}
