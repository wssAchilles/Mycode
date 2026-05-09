use std::collections::HashMap;

use serde_json::Value;

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

pub fn stage_detail_violations(
    stage_name: &str,
    actual: Option<&HashMap<String, Value>>,
    expected: &HashMap<String, Value>,
) -> Vec<String> {
    let Some(detail) = actual else {
        return vec![format!("stage_detail_missing_stage: stage={stage_name}")];
    };

    let mut violations = Vec::new();
    for (key, expected_value) in expected {
        match detail.get(key) {
            Some(actual_value) if actual_value == expected_value => {}
            Some(actual_value) => violations.push(format!(
                "stage_detail_mismatch: stage={} key={} expected={} got={}",
                stage_name, key, expected_value, actual_value
            )),
            None => violations.push(format!(
                "stage_detail_missing_key: stage={} key={}",
                stage_name, key
            )),
        }
    }
    violations
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{score_range_violations, stage_detail_violations};

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

    #[test]
    fn stage_detail_assertions_preserve_replay_violation_contract() {
        let actual = [("owner".to_string(), json!("rust"))].into_iter().collect();
        let expected = [("owner".to_string(), json!("rust"))].into_iter().collect();

        assert!(stage_detail_violations("WeightedScorer", Some(&actual), &expected).is_empty());

        let expected = [("owner".to_string(), json!("node"))].into_iter().collect();
        assert_eq!(
            stage_detail_violations("WeightedScorer", Some(&actual), &expected),
            vec![
                "stage_detail_mismatch: stage=WeightedScorer key=owner expected=\"node\" got=\"rust\""
            ]
        );

        assert_eq!(
            stage_detail_violations("WeightedScorer", None, &actual),
            vec!["stage_detail_missing_stage: stage=WeightedScorer"]
        );
    }
}
