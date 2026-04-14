use std::collections::{BTreeMap, VecDeque};

use chrono::Utc;
use serde::Serialize;

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleStatus {
    Spawning,
    Ready,
    Running,
    Degraded,
    Blocked,
    Failed,
    Finished,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LifecyclePhase {
    ConfigLoad,
    DependencyBootstrap,
    WorkerBoot,
    HttpListen,
    Runtime,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FailureClass {
    Configuration,
    DependencyBootstrap,
    DependencyRuntime,
    Startup,
    QueueFallback,
    WorkerBoot,
    Infra,
    Unknown,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAction {
    RetryOnce,
    DegradeToCompat,
    RestartService,
    Escalate,
    Noop,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeUnitState {
    pub unit: String,
    pub phase: LifecyclePhase,
    pub status: LifecycleStatus,
    pub critical: bool,
    pub compat_mode: bool,
    pub retries: u32,
    pub recovery_action: Option<RecoveryAction>,
    pub failure_class: Option<FailureClass>,
    pub message: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyRecommendation {
    pub unit: String,
    pub action: RecoveryAction,
    pub reason: String,
    pub priority: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlPlaneEvent {
    pub seq: u64,
    pub at: String,
    pub unit: String,
    pub phase: LifecyclePhase,
    pub status: LifecycleStatus,
    pub detail: Option<String>,
    pub failure_class: Option<FailureClass>,
    pub recovery_action: Option<RecoveryAction>,
    pub compat_mode: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlPlaneSnapshot {
    pub overall_status: LifecycleStatus,
    pub units: Vec<RuntimeUnitState>,
    pub recommendations: Vec<PolicyRecommendation>,
    pub current_blocker: Option<PolicyRecommendation>,
    pub event_trail: Vec<ControlPlaneEvent>,
    pub summary: String,
    pub generated_at: String,
}

#[derive(Debug, Clone)]
pub struct RuntimeControlPlane {
    units: BTreeMap<String, RuntimeUnitState>,
    events: VecDeque<ControlPlaneEvent>,
    seq: u64,
}

#[derive(Debug, Clone)]
pub struct MarkUnitInput<'a> {
    pub unit: &'a str,
    pub phase: LifecyclePhase,
    pub status: LifecycleStatus,
    pub critical: Option<bool>,
    pub compat_mode: Option<bool>,
    pub retries: Option<u32>,
    pub recovery_action: Option<RecoveryAction>,
    pub failure_class: Option<FailureClass>,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct FailureInput<'a> {
    pub unit: &'a str,
    pub phase: LifecyclePhase,
    pub failure_class: FailureClass,
    pub message: String,
    pub critical: Option<bool>,
    pub recovery_action: Option<RecoveryAction>,
    pub compat_mode: bool,
    pub increment_retry: bool,
}

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

pub fn evaluate_control_plane_policy(units: &[RuntimeUnitState]) -> Vec<PolicyRecommendation> {
    let mut recommendations = Vec::new();

    for unit in units {
        if unit.status == LifecycleStatus::Failed
            && unit.recovery_action == Some(RecoveryAction::RetryOnce)
            && unit.retries < 1
        {
            recommendations.push(PolicyRecommendation {
                unit: unit.unit.clone(),
                action: RecoveryAction::RetryOnce,
                reason: format!("{} 首次失败，先执行一次自动重试", unit.unit),
                priority: 10,
            });
            continue;
        }

        if unit.status == LifecycleStatus::Failed
            && unit.recovery_action == Some(RecoveryAction::DegradeToCompat)
        {
            recommendations.push(PolicyRecommendation {
                unit: unit.unit.clone(),
                action: RecoveryAction::DegradeToCompat,
                reason: format!("{} 已失败，建议切到 compat 模式保持主链路可用", unit.unit),
                priority: 20,
            });
            continue;
        }

        if matches!(
            unit.status,
            LifecycleStatus::Failed | LifecycleStatus::Blocked
        ) && unit.critical
        {
            recommendations.push(PolicyRecommendation {
                unit: unit.unit.clone(),
                action: RecoveryAction::Escalate,
                reason: format!("{} 是关键单元且当前不可用，需要人工介入", unit.unit),
                priority: 5,
            });
            continue;
        }

        if unit.status == LifecycleStatus::Degraded && unit.compat_mode {
            recommendations.push(PolicyRecommendation {
                unit: unit.unit.clone(),
                action: RecoveryAction::Noop,
                reason: format!("{} 处于 compat 模式，可继续运行但需观察", unit.unit),
                priority: 40,
            });
        }
    }

    recommendations.sort_by_key(|entry| entry.priority);
    recommendations
}

fn compute_overall_status(units: &[RuntimeUnitState]) -> LifecycleStatus {
    if units.iter().any(|unit| {
        matches!(
            unit.status,
            LifecycleStatus::Failed | LifecycleStatus::Blocked
        )
    }) {
        return LifecycleStatus::Failed;
    }
    if units
        .iter()
        .any(|unit| unit.status == LifecycleStatus::Degraded)
    {
        return LifecycleStatus::Degraded;
    }
    if !units.is_empty()
        && units.iter().all(|unit| {
            matches!(
                unit.status,
                LifecycleStatus::Ready | LifecycleStatus::Running
            )
        })
    {
        return LifecycleStatus::Running;
    }
    LifecycleStatus::Spawning
}

fn build_summary(
    overall_status: LifecycleStatus,
    units: &[RuntimeUnitState],
    recommendations: &[PolicyRecommendation],
    last_event: Option<&ControlPlaneEvent>,
) -> String {
    let degraded_units = units
        .iter()
        .filter(|unit| unit.status == LifecycleStatus::Degraded)
        .map(|unit| unit.unit.as_str())
        .collect::<Vec<_>>();
    let failed_unit = units.iter().find(|unit| {
        matches!(
            unit.status,
            LifecycleStatus::Failed | LifecycleStatus::Blocked
        )
    });
    let primary_recommendation = recommendations.first();

    let lines = [
        "Summary:".to_string(),
        format!("- Overall status: {:?}", overall_status).to_lowercase(),
        format!("- Units tracked: {}", units.len()),
        format!(
            "- Last checkpoint: {}",
            last_event
                .map(
                    |event| format!("{} -> {:?} @ {:?}", event.unit, event.status, event.phase)
                        .to_lowercase()
                )
                .unwrap_or_else(|| "none".to_string())
        ),
        format!(
            "- Current blocker: {}",
            failed_unit
                .map(|unit| {
                    format!(
                        "{} ({})",
                        unit.unit,
                        unit.failure_class
                            .map(|class| format!("{class:?}").to_lowercase())
                            .unwrap_or_else(|| "unknown".to_string())
                    )
                })
                .unwrap_or_else(|| "none".to_string())
        ),
        format!(
            "- Degraded units: {}",
            if degraded_units.is_empty() {
                "none".to_string()
            } else {
                degraded_units.join(", ")
            }
        ),
        format!(
            "- Recommended next action: {}",
            primary_recommendation
                .map(|entry| format!("{:?} on {}", entry.action, entry.unit).to_lowercase())
                .unwrap_or_else(|| "continue monitoring".to_string())
        ),
    ];

    compress_summary(&lines.join("\n"), 14, 900, 140)
}

fn compress_summary(
    summary: &str,
    max_lines: usize,
    max_chars: usize,
    max_line_chars: usize,
) -> String {
    let mut normalized = Vec::new();
    let mut seen = BTreeMap::<String, ()>::new();
    for line in summary.lines() {
        let normalized_line = truncate_line(
            &line.trim().split_whitespace().collect::<Vec<_>>().join(" "),
            max_line_chars,
        );
        if normalized_line.is_empty() {
            continue;
        }
        let dedupe_key = normalized_line.to_ascii_lowercase();
        if seen.insert(dedupe_key, ()).is_none() {
            normalized.push(normalized_line);
        }
    }

    let mut selected = Vec::new();
    for line in normalized.iter() {
        let mut next = selected.clone();
        next.push(line.clone());
        if next.len() > max_lines {
            break;
        }
        if next.join("\n").len() > max_chars {
            break;
        }
        selected.push(line.clone());
    }

    if selected.len() < normalized.len() {
        let omitted = normalized.len() - selected.len();
        let notice = truncate_line(
            &format!("- … {omitted} additional line(s) omitted."),
            max_line_chars,
        );
        let mut next = selected.clone();
        next.push(notice.clone());
        if next.len() <= max_lines && next.join("\n").len() <= max_chars {
            selected.push(notice);
        }
    }

    selected.join("\n")
}

fn truncate_line(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    if max_chars <= 1 {
        return "…".to_string();
    }
    let truncated = value.chars().take(max_chars - 1).collect::<String>();
    format!("{}…", truncated.trim_end())
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
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
