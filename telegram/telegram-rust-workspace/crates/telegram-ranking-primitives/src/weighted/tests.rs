//! 加权打分聚合与 V1/V3 归一化单元测试。

use super::{
    ActionWeightedScoreInput, HeuristicWeightedScoreInput, NEGATIVE_SCORES_OFFSET,
    NEGATIVE_WEIGHT_SUM, POSITIVE_WEIGHT_SUM, PhoenixWeightedScoreInput, TOTAL_WEIGHT_SUM,
    WeightedScoreInput, compute_weighted_score_summary, normalize_weighted_score,
    normalize_weighted_score_v3, unoffset_weighted_score_v3,
};

#[test]
fn phoenix_scores_are_primary_weighted_score_input() {
    let summary = compute_weighted_score_summary(WeightedScoreInput {
        phoenix_scores: Some(PhoenixWeightedScoreInput {
            like: 0.2,
            reply: 0.1,
            click: 0.3,
            ..PhoenixWeightedScoreInput::default()
        }),
        action_scores: Some(ActionWeightedScoreInput {
            negative: 1.0,
            ..ActionWeightedScoreInput::default()
        }),
        evidence_prior: 0.5,
        signal_prior: 0.5,
        ..WeightedScoreInput::default()
    });

    assert!(!summary.action_scores_used);
    assert!(!summary.heuristic_fallback_used);
    assert!(summary.positive_score > 0.0);
    assert_eq!(summary.negative_score, 0.0);
}

#[test]
fn action_scores_are_used_before_heuristics() {
    let summary = compute_weighted_score_summary(WeightedScoreInput {
        action_scores: Some(ActionWeightedScoreInput {
            like: 0.4,
            negative: 0.2,
            ..ActionWeightedScoreInput::default()
        }),
        heuristic_scores: HeuristicWeightedScoreInput {
            engagement_rate: 1.0,
            ..HeuristicWeightedScoreInput::default()
        },
        ..WeightedScoreInput::default()
    });

    assert!(summary.action_scores_used);
    assert!(!summary.heuristic_fallback_used);
    assert!(summary.negative_score > 0.0);
}

#[test]
fn normalizes_positive_and_negative_raw_scores() {
    assert_eq!(POSITIVE_WEIGHT_SUM, 30.55);
    assert_eq!(NEGATIVE_WEIGHT_SUM, 27.0);
    assert_eq!(NEGATIVE_SCORES_OFFSET, 0.1);
    assert!(normalize_weighted_score(1.0) > NEGATIVE_SCORES_OFFSET);
    assert!(normalize_weighted_score(-1.0) < NEGATIVE_SCORES_OFFSET);
}

#[test]
fn sanitizes_non_finite_weighted_score_inputs() {
    let summary = compute_weighted_score_summary(WeightedScoreInput {
        phoenix_scores: Some(PhoenixWeightedScoreInput {
            like: f64::NAN,
            reply: f64::INFINITY,
            click: 0.2,
            dismiss: f64::NEG_INFINITY,
            ..PhoenixWeightedScoreInput::default()
        }),
        evidence_prior: f64::NAN,
        signal_prior: f64::INFINITY,
        ..WeightedScoreInput::default()
    });

    assert_eq!(summary.positive_score, 0.1);
    assert_eq!(summary.negative_score, 0.0);
    assert_eq!(summary.evidence_score, 0.0);
    assert!(summary.raw_score.is_finite());
    assert!(normalize_weighted_score(summary.raw_score).is_finite());
    assert!(normalize_weighted_score(f64::NAN).is_finite());
    assert!(normalize_weighted_score(f64::INFINITY).is_finite());

    let overflow = compute_weighted_score_summary(WeightedScoreInput {
        phoenix_scores: Some(PhoenixWeightedScoreInput {
            like: f64::MAX,
            reply: f64::MAX,
            ..PhoenixWeightedScoreInput::default()
        }),
        evidence_prior: 1.0,
        ..WeightedScoreInput::default()
    });
    assert_eq!(overflow.base_raw_score, 0.0);
    assert_eq!(overflow.evidence_score, 0.0);
    assert_eq!(overflow.raw_score, 0.0);
}

#[test]
fn v3_normalization_uses_total_weight_sum_and_is_strictly_reversible() {
    assert!((TOTAL_WEIGHT_SUM - 57.55).abs() < 1e-12);

    let samples = [-27.0, -13.5, -1.0, -0.001, 0.0, 0.5, 10.0, 30.55];
    let mut normalized_values = Vec::new();
    for &raw in &samples {
        let norm = normalize_weighted_score_v3(raw);
        normalized_values.push(norm);
        if raw < 0.0 {
            let expected = (raw + NEGATIVE_WEIGHT_SUM) / 57.55 * NEGATIVE_SCORES_OFFSET;
            assert!((norm - expected).abs() < 1e-12);
            assert!((0.0..NEGATIVE_SCORES_OFFSET).contains(&norm));
        } else {
            let expected = raw / POSITIVE_WEIGHT_SUM + NEGATIVE_SCORES_OFFSET;
            assert!((norm - expected).abs() < 1e-12);
            assert!(norm >= NEGATIVE_SCORES_OFFSET);
        }
        let recovered = unoffset_weighted_score_v3(norm);
        assert!(
            (recovered - raw).abs() < 1e-11,
            "raw={raw} norm={norm} recovered={recovered}"
        );
    }

    for pair in normalized_values.windows(2) {
        assert!(
            pair[0] < pair[1],
            "order violated: {} >= {}",
            pair[0],
            pair[1]
        );
    }
    assert!(normalize_weighted_score_v3(f64::NAN).is_finite());
    assert_eq!(unoffset_weighted_score_v3(f64::INFINITY), 0.0);
}
