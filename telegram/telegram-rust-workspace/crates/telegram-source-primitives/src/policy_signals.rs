pub fn normalized_source_score(value: f64) -> f64 {
    if !value.is_finite() || value <= 0.0 {
        return 0.0;
    }
    if value <= 1.0 {
        value
    } else {
        value / (1.0 + value)
    }
}

pub fn source_budget_pressure(pre_policy_count: usize, budget: usize) -> f64 {
    if pre_policy_count == 0 {
        return 0.0;
    }
    clamp01(pre_policy_count.saturating_sub(budget) as f64 / pre_policy_count as f64)
}

pub fn source_policy_survival_rate(pre_policy_count: usize, candidate_count: usize) -> f64 {
    if pre_policy_count == 0 {
        return 0.0;
    }
    clamp01(candidate_count as f64 / pre_policy_count as f64)
}

pub fn source_recall_confidence(
    source_rank_score: f64,
    normalized_source_score: f64,
    budget_pressure: f64,
    survival_rate: f64,
) -> f64 {
    clamp01(
        0.38 + source_rank_score * 0.24 + normalized_source_score * 0.18 - budget_pressure * 0.08
            + survival_rate * 0.04,
    )
}

fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    use super::{
        normalized_source_score, source_budget_pressure, source_policy_survival_rate,
        source_recall_confidence,
    };

    #[test]
    fn source_policy_signals_are_bounded() {
        assert_eq!(normalized_source_score(f64::NAN), 0.0);
        assert_eq!(normalized_source_score(-1.0), 0.0);
        assert_eq!(normalized_source_score(0.5), 0.5);
        assert!(normalized_source_score(4.0) < 1.0);
        assert_eq!(source_budget_pressure(10, 5), 0.5);
        assert_eq!(source_policy_survival_rate(10, 3), 0.3);
        assert!((0.0..=1.0).contains(&source_recall_confidence(1.0, 1.0, 0.0, 1.0)));
    }
}
