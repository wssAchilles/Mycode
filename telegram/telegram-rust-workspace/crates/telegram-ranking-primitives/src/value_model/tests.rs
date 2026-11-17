//! V3 条件期望价值模型单元测试。

use super::*;

fn assert_close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1e-12,
        "actual {actual} != expected {expected}"
    );
}

#[test]
fn head_contract_has_exact_14_heads() {
    assert_eq!(V3_HEAD_COUNT, 14);
    assert_eq!(V3_HEAD_NAMES.len(), 14);
    assert_eq!(
        V3_HEAD_NAMES,
        [
            "click",
            "like",
            "reply",
            "repost",
            "quote",
            "share",
            "dwell",
            "video_view",
            "video_quality_view",
            "follow_author",
            "not_interested",
            "block_author",
            "mute_author",
            "report",
        ]
    );
}

#[test]
fn production_defaults_and_partial_serde_preserve_valid_contract() {
    let prod = V3ValueModelWeights::production_defaults();
    assert!(prod.positive_sum() > 0.0);
    assert!(prod.negative_sum() > 0.0);
    assert_close(prod.total_sum(), prod.positive_sum() + prod.negative_sum());
    assert_close(prod.effective_offset(), V3_NEGATIVE_SCORES_OFFSET);

    // 部分字段反序列化应保留默认偏移量与门槛参数
    let partial: V3ValueModelWeights =
        serde_json::from_str(r#"{"like": 2.5, "report": -80.0}"#).expect("parse partial weights");
    assert_close(partial.like, 2.5);
    assert_close(partial.negative_sum(), 80.0);
    assert_close(partial.effective_offset(), V3_NEGATIVE_SCORES_OFFSET);
}

#[test]
fn offset_score_v3_is_order_preserving_and_strictly_reversible() {
    let weights = V3ValueModelWeights {
        like: 2.0,
        reply: 4.0,
        not_interested: -10.0,
        report: -100.0,
        ..Default::default()
    };
    assert_close(weights.positive_sum(), 6.0);
    assert_close(weights.negative_sum(), 110.0);
    assert_close(weights.total_sum(), 116.0);

    let samples = [-110.0, -50.0, -4.98, -0.0001, 0.0, 0.0001, 0.5, 6.0, 25.0];
    let mut mapped = Vec::new();
    for &raw in &samples {
        let s = offset_score_v3(raw, &weights);
        mapped.push(s);
        if raw < 0.0 {
            assert!((0.0..V3_NEGATIVE_SCORES_OFFSET).contains(&s));
        } else {
            assert!(s >= V3_NEGATIVE_SCORES_OFFSET);
        }
        let recovered = unoffset_score_v3(s, &weights);
        assert!(
            (recovered - raw).abs() < 1e-9,
            "raw={raw} mapped={s} recovered={recovered}"
        );
    }

    // 严格保序：任意严格递增的输入在压缩后依然严格递增
    for pair in mapped.windows(2) {
        assert!(
            pair[0] < pair[1],
            "order inverted: {} >= {}",
            pair[0],
            pair[1]
        );
    }
}

#[test]
fn offset_score_v3_handles_extreme_negative_and_zero_weights() {
    let weights = V3ValueModelWeights {
        like: 2.0,
        report: -10.0,
        ..Default::default()
    };
    // 极端负分（包含额外连续扣减超出 -neg_sum 时）被安全截断到 0.0
    assert_eq!(offset_score_v3(-50.0, &weights), 0.0);

    let zero_weights = V3ValueModelWeights::default();
    assert_eq!(offset_score_v3(-1.5, &zero_weights), 0.0);
    assert_eq!(offset_score_v3(2.5, &zero_weights), 2.5);
    assert_eq!(unoffset_score_v3(f64::NAN, &weights), 0.0);
    assert_eq!(unoffset_score_v3(f64::INFINITY, &weights), 0.0);
}

#[test]
fn conditional_expectations_and_mutual_follow_reply_boost_compute_accurately() {
    let weights = V3ValueModelWeights {
        click: 0.5,
        like: 2.0,
        reply: 4.0,
        video_view: 1.0,
        video_quality_view: 3.0,
        report: -100.0,
        cont_dwell_time: 0.1,
        video_view_expected_dwell_sec: 0.2,
        click_expected_dwell_sec: 0.3,
        mutual_follow_reply_boost: 1.5,
        ..Default::default()
    };

    let mutual_original = V3CandidateScoringInputs {
        predictions: V3PhoenixPredictions {
            click: 0.2,
            like: 0.5,
            reply: 0.1,
            video_view: 0.4,
            video_quality_view: 0.5,
            cont_dwell_time: 10.0,
            expected_dwell_sec: 12.0,
            ..Default::default()
        },
        is_mutual_follow_author: true,
        is_reply: false,
        is_repost: false,
        video_duration_sec: Some(15.0),
        vqv_eligible: true,
        ..Default::default()
    };

    let bd = compute_v3_score_breakdown(&weights, &mutual_original);
    // 正向 14 头：0.5*0.2 + 2.0*0.5 + 4.0*0.1 + 1.0*0.4 + 3.0*0.5 = 3.4
    assert_close(bd.positive_score, 3.4);
    // 连续停留：0.1 * 10.0 = 1.0
    assert_close(bd.cont_dwell_score, 1.0);
    // 条件期望乘积：0.2 * (0.4 * 12.0) + 0.3 * (0.2 * 12.0) = 0.96 + 0.72 = 1.68
    assert_close(bd.conditional_expectation_score, 1.68);
    // 互关回复加成：1.5 * 0.1 = 0.15
    assert_close(bd.mutual_follow_reply_boost_score, 0.15);
    assert_close(bd.combined_score, 3.4 + 1.0 + 1.68 + 0.15);
    assert_close(
        bd.offset_score,
        bd.combined_score + V3_NEGATIVE_SCORES_OFFSET,
    );

    // 如果是回复帖或非互关，不触发互关加成；视频时长不足 5s 则 VQV 不生效
    let short_reply = V3CandidateScoringInputs {
        is_reply: true,
        video_duration_sec: Some(2.0),
        ..mutual_original
    };
    let short_bd = compute_v3_score_breakdown(&weights, &short_reply);
    assert_close(short_bd.mutual_follow_reply_boost_score, 0.0);
    assert_close(short_bd.positive_score, 3.4 - 1.5);
}

#[test]
fn author_diversity_multiplier_matches_exponential_floor_formula() {
    assert_close(author_diversity_multiplier(0.5, 0.25, 0), 1.0);
    assert_close(author_diversity_multiplier(0.5, 0.25, 1), 0.625);
    assert_close(author_diversity_multiplier(0.5, 0.25, 2), 0.4375);
    assert_close(author_diversity_multiplier(0.8, 0.3, 0), 1.0);
    assert_close(author_diversity_multiplier(0.8, 0.3, 1), 0.86);
    assert!(author_diversity_multiplier(0.8, 0.3, 100) >= 0.3);
    assert!(author_diversity_multiplier(0.8, 0.3, u32::MAX) >= 0.3);
}

#[test]
fn batch_scoring_applies_exploration_bonus_diversity_and_oon() {
    let weights = V3ValueModelWeights {
        like: 2.0,
        report: -100.0,
        enable_author_diversity: true,
        author_diversity_decay: 0.5,
        author_diversity_floor: 0.25,
        oon_weight_factor: 0.75,
        ..Default::default()
    };
    let c1 = V3CandidateScoringInputs {
        predictions: V3PhoenixPredictions {
            like: 0.5,
            ..Default::default()
        },
        ..Default::default()
    };
    let c2 = V3CandidateScoringInputs {
        predictions: V3PhoenixPredictions {
            like: 0.3,
            ..Default::default()
        },
        out_of_network: true,
        ..Default::default()
    };
    let c3 = V3CandidateScoringInputs {
        predictions: V3PhoenixPredictions {
            like: 0.2,
            ..Default::default()
        },
        author_exploration_bonus: 0.5,
        ..Default::default()
    };

    let batch = compute_v3_batch_scores(&weights, &[("a1", c1), ("a1", c2), ("a2", c3)]);
    // c1 (1.001) 与 c2 (0.601) 同作者 a1，c1 排第 0 位 (乘 1.0)，c2 排第 1 位 (乘 0.625 * 0.75)
    assert_close(batch.scores[0], 1.001);
    assert_close(batch.scores[1], 0.601 * 0.625 * 0.75);
    // c3 基础分 0.4 + bonus 0.5 = 0.9 -> offset 0.901，作者 a2 第 0 位
    assert_close(batch.weighted[2], 0.901);
    assert_close(batch.scores[2], 0.901);
}
