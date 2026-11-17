//! 轻量 PIT UserDebias 单元测试（含与 V3 价值模型协同消偏校验）。

use crate::value_model::{
    V3_HEAD_COUNT, V3CandidateScoringInputs, V3PhoenixPredictions, V3ValueModelWeights,
    compute_v3_value_score,
};

use super::*;

#[test]
fn logit_debias_recenters_and_clips_correctly() {
    let raw = 0.3;
    // 用户自身喜欢率显著高于全局（bias = 1.5 - 0.5 = +1.0），消偏后概率应低于原始概率
    let debiased = apply_logit_debias(raw, 1.0, 2.0);
    let logit_expected = (0.3_f64 / 0.7_f64).ln() - 1.0;
    let expected = 1.0 / (1.0 + (-logit_expected).exp());
    assert!((debiased - expected).abs() < 1e-12);
    assert!(debiased < raw);

    // 用户偏置为负（挑剔用户）时，消偏后应抬高概率
    let boosted = apply_logit_debias(raw, -0.8, 2.0);
    assert!(boosted > raw);

    // 零偏置时应恒等还原
    assert!((apply_logit_debias(0.42, 0.0, 2.0) - 0.42).abs() < 1e-12);

    // 极端偏置必须受到 clip 限幅约束
    let clipped = apply_logit_debias(0.5, 99.0, 1.5);
    let max_shift = apply_logit_debias(0.5, 1.5, 1.5);
    assert!((clipped - max_shift).abs() < 1e-12);

    // 边界值与非法参数安全兜底
    assert_eq!(apply_logit_debias(0.0, 1.0, 2.0), 0.0);
    assert_eq!(apply_logit_debias(1.0, 1.0, 2.0), 1.0);
    assert_eq!(apply_logit_debias(0.5, f64::NAN, 2.0), 0.5);
    assert_eq!(apply_logit_debias(f64::NAN, 1.0, 2.0), 0.0);
}

#[test]
fn pit_retain_until_drops_future_entries_and_prevents_leakage() {
    let mut store = UserDebiasStore::new(1_700_000_000_000, 3600.0);
    let mut early = [0.0; V3_HEAD_COUNT];
    early[1] = 0.4;
    let mut at_req = [0.0; V3_HEAD_COUNT];
    at_req[1] = 0.8;
    let mut future = [0.0; V3_HEAD_COUNT];
    future[1] = 1.9;

    store.insert_entry(
        "u1",
        UserDebiasEntry {
            timestamp_ms: 3000,
            action_biases: future,
        },
    );
    store.insert_entry(
        "u1",
        UserDebiasEntry {
            timestamp_ms: 1000,
            action_biases: early,
        },
    );
    store.insert_entry(
        "u1",
        UserDebiasEntry {
            timestamp_ms: 2000,
            action_biases: at_req,
        },
    );

    // 无副作用 PIT 二分查询严格遵守 <= req_ms
    assert_eq!(
        store.entry_for_user("u1", 1500).map(|e| e.action_biases[1]),
        Some(0.4)
    );
    assert_eq!(
        store.entry_for_user("u1", 2000).map(|e| e.action_biases[1]),
        Some(0.8)
    );
    assert!(store.entry_for_user("u1", 999).is_none());

    // 执行 retain_until(2000) 硬截断未来条目（t=2000 保留，t=3000 丢弃）
    store.retain_until(2000);
    assert_eq!(store.total_entries(), 2);
    assert_eq!(
        store.entry_for_user("u1", 9999).map(|e| e.action_biases[1]),
        Some(0.8)
    );

    // 截断至所有记录之前时清空用户
    store.retain_until(500);
    assert_eq!(store.user_count(), 0);
    assert_eq!(store.total_entries(), 0);
}

#[test]
fn stale_artifact_and_missing_user_skip_with_fail_open_fallback() {
    let trained_at = 1_700_000_000_000;
    let store = {
        let mut s = UserDebiasStore::new(trained_at, 3600.0);
        let mut biases = [0.0; V3_HEAD_COUNT];
        biases[1] = 1.2;
        s.insert_entry(
            "u1",
            UserDebiasEntry {
                timestamp_ms: trained_at - 10_000,
                action_biases: biases,
            },
        );
        s
    };

    // 产物在 3600s 有效期内 -> 正常消偏并传导至 V3 价值打分
    let mut fresh_preds = V3PhoenixPredictions {
        like: 0.5,
        expected_dwell_sec: 12.0,
        ..Default::default()
    };
    let weights = V3ValueModelWeights {
        like: 2.0,
        ..Default::default()
    };
    let raw_score = compute_v3_value_score(
        &weights,
        &V3CandidateScoringInputs {
            predictions: fresh_preds,
            ..Default::default()
        },
    );
    let fresh_now = trained_at + 1_800_000;
    assert_eq!(
        store.debias_predictions("u1", &mut fresh_preds, fresh_now, fresh_now),
        DebiasOutcome::Applied
    );
    let debiased_score = compute_v3_value_score(
        &weights,
        &V3CandidateScoringInputs {
            predictions: fresh_preds,
            ..Default::default()
        },
    );
    assert!(debiased_score < raw_score);
    assert_eq!(fresh_preds.expected_dwell_sec, 12.0);

    // 超过 3600s 过期阈值 -> 自动跳过回退并保留原始概率
    let mut stale_preds = V3PhoenixPredictions {
        like: 0.5,
        ..Default::default()
    };
    let stale_now = trained_at + 3_601_000;
    assert_eq!(
        store.debias_predictions("u1", &mut stale_preds, stale_now, stale_now),
        DebiasOutcome::Skipped(DebiasSkipReason::StaleArtifact)
    );
    assert_eq!(stale_preds.like, 0.5);

    // 未知用户或越界 head_index 安全回退原值
    assert_eq!(
        store.debias_head("unknown", 1, 0.4, fresh_now, fresh_now),
        0.4
    );
    assert_eq!(
        store.debias_head("u1", V3_HEAD_COUNT + 1, 0.4, fresh_now, fresh_now),
        0.4
    );
}

#[test]
fn json_round_trip_and_snapshot_handle_reload() {
    let mut store = UserDebiasStore::new(1_700_000_000_000, 3600.0);
    let mut biases = [0.0; V3_HEAD_COUNT];
    biases[0] = 0.25;
    store.insert_entry(
        "u-json",
        UserDebiasEntry {
            timestamp_ms: 1_700_000_000_000,
            action_biases: biases,
        },
    );
    let json = store.to_json_string().expect("serialize debias store");

    let handle = UserDebiasSnapshotHandle::empty();
    assert!(
        handle
            .reload_from_bytes(json.as_bytes())
            .expect("first load")
    );
    // 相同指纹应跳过重复解析
    assert!(
        !handle
            .reload_from_bytes(json.as_bytes())
            .expect("dedup skip")
    );

    let snap = handle.snapshot().expect("snapshot available");
    assert_eq!(snap.user_count(), 1);
    assert_eq!(
        snap.entry_for_user("u-json", 1_700_000_000_000)
            .map(|e| e.action_biases[0]),
        Some(0.25)
    );
}
