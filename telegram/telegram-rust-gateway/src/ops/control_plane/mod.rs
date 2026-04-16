use std::collections::{BTreeMap, VecDeque};

mod model;
mod policy;
mod summary;

pub use model::{
    ControlPlaneEvent, ControlPlaneSnapshot, FailureClass, FailureInput, LifecyclePhase,
    LifecycleStatus, MarkUnitInput, PolicyRecommendation, RecoveryAction, RuntimeControlPlane,
    RuntimeUnitState,
};
pub use policy::evaluate_control_plane_policy;
pub use summary::{build_summary, compress_summary};

use model::now_iso;
use policy::compute_overall_status;

impl RuntimeControlPlane {
    pub fn new() -> Self {
        Self {
            units: BTreeMap::new(),
            events: VecDeque::with_capacity(200),
            seq: 0,
        }
    }

    pub fn mark_unit(&mut self, input: MarkUnitInput<'_>) -> RuntimeUnitState {
        let previous = self.units.get(input.unit).cloned();
        let next = RuntimeUnitState {
            unit: input.unit.to_string(),
            phase: input.phase,
            status: input.status,
            critical: input
                .critical
                .unwrap_or_else(|| previous.as_ref().map(|unit| unit.critical).unwrap_or(false)),
            compat_mode: input.compat_mode.unwrap_or_else(|| {
                previous
                    .as_ref()
                    .map(|unit| unit.compat_mode)
                    .unwrap_or(false)
            }),
            retries: input
                .retries
                .unwrap_or_else(|| previous.as_ref().map(|unit| unit.retries).unwrap_or(0)),
            recovery_action: input
                .recovery_action
                .or_else(|| previous.as_ref().and_then(|unit| unit.recovery_action)),
            failure_class: input
                .failure_class
                .or_else(|| previous.as_ref().and_then(|unit| unit.failure_class)),
            message: input
                .message
                .clone()
                .or_else(|| previous.as_ref().and_then(|unit| unit.message.clone())),
            updated_at: now_iso(),
        };
        self.units.insert(next.unit.clone(), next.clone());
        self.append_event(&input);
        next
    }

    pub fn mark_failure(&mut self, input: FailureInput<'_>) -> RuntimeUnitState {
        let previous = self.units.get(input.unit).cloned();
        self.mark_unit(MarkUnitInput {
            unit: input.unit,
            phase: input.phase,
            status: if input.compat_mode {
                LifecycleStatus::Degraded
            } else {
                LifecycleStatus::Failed
            },
            critical: input
                .critical
                .or_else(|| previous.as_ref().map(|unit| unit.critical)),
            compat_mode: Some(input.compat_mode),
            retries: Some(
                previous.as_ref().map(|unit| unit.retries).unwrap_or(0)
                    + u32::from(input.increment_retry),
            ),
            recovery_action: input
                .recovery_action
                .or(previous.as_ref().and_then(|unit| unit.recovery_action))
                .or(Some(RecoveryAction::Escalate)),
            failure_class: Some(input.failure_class),
            message: Some(input.message),
        })
    }

    pub fn record_recovery(
        &mut self,
        unit: &str,
        detail: impl Into<String>,
        phase: Option<LifecyclePhase>,
        status: Option<LifecycleStatus>,
        compat_mode: Option<bool>,
    ) -> RuntimeUnitState {
        let previous = self.units.get(unit).cloned();
        self.mark_unit(MarkUnitInput {
            unit,
            phase: phase.unwrap_or_else(|| {
                previous
                    .as_ref()
                    .map(|state| state.phase)
                    .unwrap_or(LifecyclePhase::Runtime)
            }),
            status: status.unwrap_or(LifecycleStatus::Running),
            critical: previous.as_ref().map(|state| state.critical),
            compat_mode: compat_mode.or_else(|| previous.as_ref().map(|state| state.compat_mode)),
            retries: previous.as_ref().map(|state| state.retries),
            recovery_action: previous.as_ref().and_then(|state| state.recovery_action),
            failure_class: previous.as_ref().and_then(|state| state.failure_class),
            message: Some(detail.into()),
        })
    }

    pub fn snapshot(&self) -> ControlPlaneSnapshot {
        let units = self.units.values().cloned().collect::<Vec<_>>();
        let recommendations = evaluate_control_plane_policy(&units);
        let overall_status = compute_overall_status(&units);
        let last_event = self.events.back().cloned();
        let summary = build_summary(
            overall_status,
            &units,
            &recommendations,
            last_event.as_ref(),
        );

        ControlPlaneSnapshot {
            overall_status,
            units,
            current_blocker: recommendations
                .iter()
                .find(|entry| entry.priority <= 20)
                .cloned(),
            recommendations,
            event_trail: self.events.iter().cloned().collect(),
            summary,
            generated_at: now_iso(),
        }
    }

    fn append_event(&mut self, input: &MarkUnitInput<'_>) {
        self.seq += 1;
        self.events.push_back(ControlPlaneEvent {
            seq: self.seq,
            at: now_iso(),
            unit: input.unit.to_string(),
            phase: input.phase,
            status: input.status,
            detail: input.message.clone(),
            failure_class: input.failure_class,
            recovery_action: input.recovery_action,
            compat_mode: input.compat_mode.unwrap_or(false),
        });
        if self.events.len() > 200 {
            self.events.pop_front();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn policy_prefers_escalation_for_failed_critical_units() {
        let units = vec![RuntimeUnitState {
            unit: "upstream_http".to_string(),
            phase: LifecyclePhase::Runtime,
            status: LifecycleStatus::Failed,
            critical: true,
            compat_mode: false,
            retries: 1,
            recovery_action: Some(RecoveryAction::RetryOnce),
            failure_class: Some(FailureClass::DependencyRuntime),
            message: Some("upstream down".to_string()),
            updated_at: now_iso(),
        }];

        let recommendations = evaluate_control_plane_policy(&units);
        assert_eq!(recommendations[0].action, RecoveryAction::Escalate);
    }

    #[test]
    fn summary_is_compressed() {
        let summary = compress_summary(
            "Summary:\n- a   \n- a\n- b\n- c\n- d\n- e\n- f\n- g\n- h\n- i\n- j\n- k\n- l\n- m\n- n",
            5,
            120,
            32,
        );
        assert!(summary.lines().count() <= 5);
        assert!(summary.len() <= 120);
    }
}
