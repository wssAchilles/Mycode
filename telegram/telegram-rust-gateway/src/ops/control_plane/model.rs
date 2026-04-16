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
    pub(super) units: BTreeMap<String, RuntimeUnitState>,
    pub(super) events: VecDeque<ControlPlaneEvent>,
    pub(super) seq: u64,
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

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}
