use std::collections::BTreeMap;

use super::model::{
    ControlPlaneEvent, LifecycleStatus, PolicyRecommendation, RuntimeUnitState,
};

pub fn build_summary(
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

pub fn compress_summary(
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
