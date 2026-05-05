pub fn score_range_violations(
    label: &str,
    post_id: &str,
    actual: Option<f64>,
    min_value: Option<f64>,
    max_value: Option<f64>,
) -> Vec<String> {
    let Some(actual) = actual.filter(|value| value.is_finite()) else {
        if min_value.is_some() || max_value.is_some() {
            return vec![format!(
                "score_range_missing_value: post_id={} field={}",
                post_id, label
            )];
        }
        return Vec::new();
    };

    let mut violations = Vec::new();
    if let Some(min_value) = min_value
        && actual < min_value
    {
        violations.push(format!(
            "score_range_below_min: post_id={} field={} min={} got={}",
            post_id, label, min_value, actual
        ));
    }
    if let Some(max_value) = max_value
        && actual > max_value
    {
        violations.push(format!(
            "score_range_above_max: post_id={} field={} max={} got={}",
            post_id, label, max_value, actual
        ));
    }
    violations
}

#[cfg(test)]
mod tests {
    use super::score_range_violations;

    #[test]
    fn score_range_assertions_preserve_replay_violation_contract() {
        assert!(
            score_range_violations("score", "post-1", Some(0.5), Some(0.1), Some(0.9)).is_empty()
        );
        assert_eq!(
            score_range_violations("score", "post-1", None, Some(0.1), None),
            vec!["score_range_missing_value: post_id=post-1 field=score"]
        );
        assert_eq!(
            score_range_violations("score", "post-1", Some(0.0), Some(0.1), None),
            vec!["score_range_below_min: post_id=post-1 field=score min=0.1 got=0"]
        );
    }
}
