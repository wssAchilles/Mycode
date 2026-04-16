use super::model::{LifecycleStatus, PolicyRecommendation, RecoveryAction, RuntimeUnitState};

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

pub fn compute_overall_status(units: &[RuntimeUnitState]) -> LifecycleStatus {
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
