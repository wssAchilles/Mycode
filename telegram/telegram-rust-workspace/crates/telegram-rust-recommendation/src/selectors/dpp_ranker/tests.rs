use std::collections::HashMap;
use std::time::Instant;

use chrono::Utc;

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, ServedHistoryEntryPayload,
};

use super::config::{DppConfig, SlidingWindow};
use super::kernel::{
    DppInput, build_dpp_input_from_candidate, dot_product_f32, sid_to_normalized_256d_proxy,
};
use super::{rerank_candidates, rescore, rescore_with_metrics};

fn make_input(id: u64, score: f64, embedding: &[f32]) -> DppInput {
    let norm = super::kernel::l2_norm_f32(embedding);
    DppInput {
        index: id as usize,
        post_id: format!("post-{id}"),
        score,
        embedding: embedding.to_vec(),
        norm,
        embedding_missing: false,
        is_unit: false,
        l1: None,
        l2: None,
        l3: None,
    }
}

fn default_config() -> DppConfig {
    DppConfig {
        top_k: 10,
        theta: 0.5,
        max_selected_rank: 50,
        greedy_order: false,
        window: None,
    }
}

fn make_candidate(
    post_id: &str,
    score: f64,
    embedding: Option<Vec<f32>>,
    semantic_ids: Option<[i32; 6]>,
) -> RecommendationCandidatePayload {
    RecommendationCandidatePayload {
        post_id: post_id.to_string(),
        author_id: format!("author-{post_id}"),
        content: "dpp test candidate".to_string(),
        created_at: Utc::now(),
        score: Some(score),
        weighted_score: Some(score),
        pipeline_score: Some(score),
        semantic_embedding_256d: embedding,
        semantic_ids,
        ..Default::default()
    }
}

#[test]
fn empty_input_returns_empty() {
    let result = rescore(&[], None, &[], &default_config());
    assert!(result.is_empty());
}

#[test]
fn single_candidate_preserves_id_and_score() {
    let inputs = vec![make_input(1, 5.0, &[1.0, 0.0, 0.0])];
    let result = rescore(&inputs, None, &[], &default_config());
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].pool_index, 1);
    assert!((result[0].score - 5.0).abs() < 1e-9);
}

#[test]
fn identical_embeddings_select_top_scorer_only_without_window() {
    let emb = vec![1.0, 0.0, 0.0];
    let inputs = vec![
        make_input(0, 10.0, &emb),
        make_input(1, 5.0, &emb),
        make_input(2, 1.0, &emb),
    ];
    let config = DppConfig {
        top_k: 3,
        theta: 0.5,
        max_selected_rank: 10,
        greedy_order: false,
        window: None,
    };
    let result = rescore(&inputs, None, &[], &config);
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].pool_index, 0);
}

#[test]
fn orthogonal_embeddings_promote_diversity() {
    let inputs = vec![
        make_input(0, 10.0, &[1.0, 0.0]),
        make_input(1, 9.5, &[1.0, 0.0]),
        make_input(2, 5.0, &[0.0, 1.0]),
    ];
    let config = DppConfig {
        top_k: 3,
        theta: 0.5,
        max_selected_rank: 10,
        greedy_order: false,
        window: None,
    };
    let result = rescore(&inputs, None, &[], &config);
    let ids: Vec<usize> = result.iter().map(|r| r.pool_index).collect();
    assert!(ids.contains(&2), "正交候选应当被选出");
    assert!(!ids.contains(&1), "高度冗余的重复候选应当被抑制");
}

#[test]
fn filter_only_preserves_original_scores_descending() {
    let inputs: Vec<DppInput> = (0..20)
        .map(|i| {
            let angle = (i as f32) * std::f32::consts::PI / 10.0;
            make_input(
                i as u64,
                10.0 - (i as f64) * 0.4,
                &[angle.cos(), angle.sin()],
            )
        })
        .collect();
    let config = DppConfig {
        top_k: 10,
        theta: 0.5,
        max_selected_rank: 20,
        greedy_order: false,
        window: None,
    };
    let result = rescore(&inputs, None, &[], &config);
    assert!(result.len() <= 10);
    assert!(!result.is_empty());
    for w in result.windows(2) {
        assert!(w[0].score >= w[1].score, "输出分数必须保持单调降序");
    }
    for r in &result {
        let orig = &inputs[r.pool_index];
        assert!((r.score - orig.score).abs() < 1e-9);
    }
}

#[test]
fn max_selected_rank_limits_pool() {
    let inputs: Vec<DppInput> = (0..100)
        .map(|i| {
            let angle = (i as f32) * std::f32::consts::PI / 100.0;
            make_input(i as u64, 100.0 - (i as f64), &[angle.cos(), angle.sin()])
        })
        .collect();
    let config = DppConfig {
        top_k: 5,
        theta: 0.5,
        max_selected_rank: 10,
        greedy_order: false,
        window: None,
    };
    let result = rescore(&inputs, None, &[], &config);
    assert!(result.len() <= 5);
    assert!(!result.is_empty());
    for r in &result {
        assert!(r.pool_index < 10, "只允许从 Top-10 池中选择");
    }
}

#[test]
fn seed_suppresses_near_duplicate_without_consuming_budget() {
    let seed_dup = make_input(999, 0.0, &[1.0, 0.0]);
    let inputs = vec![
        make_input(0, 10.0, &[1.0, 0.0]),
        make_input(1, 5.0, &[0.0, 1.0]),
    ];
    let config = DppConfig {
        top_k: 2,
        theta: 0.5,
        max_selected_rank: 10,
        greedy_order: false,
        window: None,
    };
    let res = rescore(&inputs, Some(&seed_dup), &[], &config);
    let ids: Vec<usize> = res.iter().map(|r| r.pool_index).collect();
    assert!(!ids.contains(&0));
    assert!(ids.contains(&1));

    let seed_orth = make_input(999, 0.0, &[0.0, 0.0, 1.0]);
    let inputs2 = vec![
        make_input(0, 10.0, &[1.0, 0.0, 0.0]),
        make_input(1, 5.0, &[0.0, 1.0, 0.0]),
    ];
    let res2 = rescore(&inputs2, Some(&seed_orth), &[], &config);
    assert_eq!(res2.len(), 2, "seed 不应占用 top_k 预算");
}

#[test]
fn greedy_order_serves_picks_in_selection_order_with_zip_remapped_scores() {
    let inputs = vec![
        make_input(0, 10.0, &[1.0, 0.0, 0.0]),
        make_input(1, 9.0, &[0.8, 0.0, 0.6]),
        make_input(2, 5.0, &[0.0, 1.0, 0.0]),
    ];
    let mut config = DppConfig {
        top_k: 3,
        ..default_config()
    };
    let served = |cfg: &DppConfig| -> Vec<(usize, f64)> {
        rescore(&inputs, None, &[], cfg)
            .iter()
            .map(|r| (r.pool_index, r.score))
            .collect()
    };

    assert_eq!(served(&config), [(0, 10.0), (1, 9.0), (2, 5.0)]);

    config.greedy_order = true;
    // 验证保分集合重映射：第 2 号正交项提拔至第 2 位，同时继承原第 2 高分 9.0
    assert_eq!(served(&config), [(0, 10.0), (2, 9.0), (1, 5.0)]);
}

#[test]
fn window_suppresses_duplicate_inside_window_and_ignores_missing_embeddings() {
    let inputs = vec![
        make_input(0, 10.0, &[1.0, 0.0, 0.0, 0.0]),
        make_input(1, 9.0, &[1.0, 0.0, 0.0, 0.0]),
        make_input(2, 5.0, &[0.0, 1.0, 0.0, 0.0]),
        make_input(3, 4.0, &[0.0, 0.0, 1.0, 0.0]),
        make_input(4, 3.0, &[0.0, 0.0, 0.0, 1.0]),
    ];
    let cfg = DppConfig {
        top_k: 5,
        theta: 0.5,
        max_selected_rank: 50,
        greedy_order: false,
        window: Some(SlidingWindow {
            size: 2,
            half_distance: 5.0,
            sid_lambda: 0.0,
        }),
    };
    let ids: Vec<usize> = rescore(&inputs, None, &[], &cfg)
        .iter()
        .map(|r| r.pool_index)
        .collect();
    assert_eq!(ids, vec![0, 2, 3, 1, 4]);

    let mut missing_1 = make_input(1, 9.0, &[1.0, 0.0]);
    missing_1.embedding_missing = true;
    let mut missing_hist = make_input(9, 0.0, &[1.0, 0.0]);
    missing_hist.embedding_missing = true;
    let inputs_missing = vec![
        make_input(0, 10.0, &[1.0, 0.0]),
        missing_1,
        make_input(2, 5.0, &[0.0, 1.0]),
    ];
    let cfg_win1 = DppConfig {
        top_k: 3,
        window: Some(SlidingWindow {
            size: 1,
            half_distance: 5.0,
            sid_lambda: 0.0,
        }),
        ..cfg
    };
    let ids_missing: Vec<usize> = rescore(&inputs_missing, None, &[missing_hist], &cfg_win1)
        .iter()
        .map(|r| r.pool_index)
        .collect();
    assert_eq!(ids_missing, vec![0, 1, 2]);
}

#[test]
fn sid_proxy_256d_preserves_hierarchy_and_orthogonality() {
    let sid_a = sid_to_normalized_256d_proxy(&[12, 44, 78, 99, 128, 255]).expect("sid_a");
    let sid_a_same_l1_l2 =
        sid_to_normalized_256d_proxy(&[12, 44, 15, 22, 33, 44]).expect("sid_a_l12");
    let sid_a_same_l1 = sid_to_normalized_256d_proxy(&[12, 200, 15, 22, 33, 44]).expect("sid_a_l1");
    let sid_b_diff = sid_to_normalized_256d_proxy(&[99, 120, 180, 11, 22, 33]).expect("sid_b");

    assert_eq!(sid_a.len(), 256);
    let cos_self = dot_product_f32(&sid_a, &sid_a);
    let cos_l1_l2 = dot_product_f32(&sid_a, &sid_a_same_l1_l2);
    let cos_l1 = dot_product_f32(&sid_a, &sid_a_same_l1);
    let cos_diff = dot_product_f32(&sid_a, &sid_b_diff);

    assert!((cos_self - 1.0).abs() < 1e-4, "同 SID 必须自相似为 1.0");
    assert!(
        cos_l1_l2 > cos_l1 && cos_l1 > cos_diff.abs(),
        "L1+L2 相似度({cos_l1_l2}) > 仅 L1({cos_l1}) > 异构({cos_diff})"
    );
    assert!(
        cos_diff.abs() < 0.15,
        "不同 SID 代理向量应当近似正交，实际 cos={cos_diff}"
    );
}

#[test]
fn sid_only_candidates_participate_in_dpp_and_sid_lambda_repulsion() {
    // 候选均缺少 256d 向量，但携带 Semantic ID
    let mut candidates = Vec::new();
    // 前 5 条共享同一 L1/L2 前缀 [10, 20, ...]
    for i in 0..5 {
        candidates.push(make_candidate(
            &format!("cluster-a-{i}"),
            10.0 - (i as f64) * 0.1,
            None,
            Some([10, 20, 30 + i, 1, 2, 3]),
        ));
    }
    // 后 5 条各自属于不同 L1 语义簇
    for i in 0..5 {
        let code = 50 + i * 17;
        candidates.push(make_candidate(
            &format!("cluster-other-{i}"),
            8.5 - (i as f64) * 0.1,
            None,
            Some([code, code + 1, code + 2, 4, 5, 6]),
        ));
    }

    let query = RecommendationQueryPayload {
        request_id: "req-sid-dpp".to_string(),
        decision_id: "00000000-0000-4000-8000-000000000001".to_string(),
        user_id: "viewer-1".to_string(),
        limit: 5,
        feature_switches: HashMap::from([("enable_v3_dpp".to_string(), true)]),
        ..Default::default()
    };
    let config = DppConfig {
        top_k: 5,
        theta: 0.65,
        max_selected_rank: 150,
        greedy_order: false,
        window: Some(SlidingWindow {
            size: 10,
            half_distance: 3.0,
            sid_lambda: 0.15,
        }),
    };

    let out = rerank_candidates(&query, &candidates, &config, false, Some(5));
    assert_eq!(out.candidates.len(), 5);
    assert!(out.metrics.applied);
    assert!(
        out.metrics.avg_pairwise_cosine_after < out.metrics.avg_pairwise_cosine_before,
        "重排后平均余弦({})必须严格小于重排前({})",
        out.metrics.avg_pairwise_cosine_after,
        out.metrics.avg_pairwise_cosine_before
    );
    assert!((out.metrics.sid_coverage_ratio - 1.0).abs() < 1e-6);
    assert!((out.metrics.embedding_coverage_ratio - 1.0).abs() < 1e-6);

    // 验证第一条保留 cluster-a-0，随后立即插入不同簇而非连续 cluster-a-1..4
    assert_eq!(out.candidates[0].post_id, "cluster-a-0");
    assert!(
        out.candidates[1].post_id.starts_with("cluster-other-"),
        "第 2 位应被多样性打散至不同 SID 簇，实际为 {}",
        out.candidates[1].post_id
    );

    // 验证保分集合重映射：分数单调不增，且 pre_diversity_score 保留原始自身分数
    for w in out.candidates.windows(2) {
        assert!(w[0].final_score() >= w[1].final_score());
    }
    let second_ctx = out.candidates[1]
        .slate_context
        .as_ref()
        .expect("slate_context 必须写入");
    assert_eq!(second_ctx.k, Some(1));
    assert_eq!(second_ctx.sid_known, Some(true));
    assert!(second_ctx.pre_diversity_score.unwrap() < 9.0);
    assert!(
        (out.candidates[1].final_score() - 8.5).abs() < 1e-9,
        "第 2 位应通过保分集合重映射继承选中集第 2 高分 8.5，实际为 {}",
        out.candidates[1].final_score()
    );
}

#[test]
fn dpp_top150_latency_under_1ms_and_reduces_cosine_similarity() {
    // 构造 150 个 256 维语义候选：前 40 条集中在高相似主题方向，后 110 条均匀分布于正交/分散子空间
    let mut candidates = Vec::with_capacity(150);
    for i in 0..150 {
        let mut emb = vec![0.0_f32; 256];
        if i < 40 {
            emb[0] = 1.0;
            emb[1] = (i as f32) * 0.005;
        } else {
            let dim = (i - 39) % 250 + 2;
            emb[dim] = 1.0;
            emb[(dim + 7) % 256] = 0.25;
        }
        candidates.push(make_candidate(
            &format!("post-{i}"),
            150.0 - (i as f64),
            Some(emb),
            Some([(i as i32) % 8, (i as i32) % 16, 1, 2, 3, 4]),
        ));
    }

    let inputs: Vec<DppInput> = candidates
        .iter()
        .enumerate()
        .map(|(idx, c)| build_dpp_input_from_candidate(idx, c))
        .collect();

    // 1. 测试默认滑动窗口模式 Top-150 -> Top-30
    let win_cfg = DppConfig {
        top_k: 30,
        theta: 0.65,
        max_selected_rank: 150,
        greedy_order: false,
        window: Some(SlidingWindow {
            size: 10,
            half_distance: 3.0,
            sid_lambda: 0.15,
        }),
    };
    let _ = rescore_with_metrics(&inputs, None, &[], &win_cfg, None);
    let t_win = Instant::now();
    let win_out = rescore_with_metrics(&inputs, None, &[], &win_cfg, None);
    let win_us = t_win.elapsed().as_micros();
    assert_eq!(win_out.results.len(), 30);
    assert!(
        win_out.metrics.avg_pairwise_cosine_after < win_out.metrics.avg_pairwise_cosine_before,
        "滑窗模式 avg_pairwise_cosine_after({}) 必须小于 before({})",
        win_out.metrics.avg_pairwise_cosine_after,
        win_out.metrics.avg_pairwise_cosine_before
    );

    // 2. 测试纯增量 Cholesky MAP 贪心模式 Top-150 -> Top-30
    let chol_cfg = DppConfig {
        top_k: 30,
        theta: 0.65,
        max_selected_rank: 150,
        greedy_order: false,
        window: None,
    };
    let _ = rescore_with_metrics(&inputs, None, &[], &chol_cfg, None);
    let t_chol = Instant::now();
    let chol_out = rescore_with_metrics(&inputs, None, &[], &chol_cfg, None);
    let chol_us = t_chol.elapsed().as_micros();
    assert_eq!(chol_out.results.len(), 30);
    assert!(
        chol_out.metrics.avg_pairwise_cosine_after < chol_out.metrics.avg_pairwise_cosine_before,
        "Cholesky 模式 avg_pairwise_cosine_after({}) 必须小于 before({})",
        chol_out.metrics.avg_pairwise_cosine_after,
        chol_out.metrics.avg_pairwise_cosine_before
    );

    eprintln!(
        "DPP Top-150 -> 30 耗时: window_greedy={} us, cholesky_dpp={} us (cos_before={:.4}, cos_after={:.4})",
        win_us,
        chol_us,
        chol_out.metrics.avg_pairwise_cosine_before,
        chol_out.metrics.avg_pairwise_cosine_after
    );
    #[cfg(not(debug_assertions))]
    {
        assert!(
            win_us < 1_000,
            "release 下滑窗 Top-150 耗时应 < 1ms，实际 {win_us} us"
        );
        assert!(
            chol_us < 1_000,
            "release 下 Cholesky Top-150 耗时应 < 1ms，实际 {chol_us} us"
        );
    }
}

#[test]
fn served_history_context_penalizes_recent_cluster_on_next_page() {
    let hist_cand = make_candidate(
        "hist-1",
        0.0,
        Some(vec![1.0, 0.0, 0.0]),
        Some([7, 1, 0, 0, 0, 0]),
    );
    let c1 = make_candidate(
        "cand-1",
        10.0,
        Some(vec![1.0, 0.0, 0.0]),
        Some([7, 1, 0, 0, 0, 0]),
    );
    let c2 = make_candidate(
        "cand-2",
        9.0,
        Some(vec![0.0, 1.0, 0.0]),
        Some([8, 2, 0, 0, 0, 0]),
    );

    let hist_input = build_dpp_input_from_candidate(usize::MAX, &hist_cand);
    let c1_input = build_dpp_input_from_candidate(0, &c1);
    let c2_input = build_dpp_input_from_candidate(1, &c2);

    let cfg = DppConfig {
        top_k: 2,
        theta: 0.65,
        max_selected_rank: 150,
        greedy_order: false,
        window: Some(SlidingWindow {
            size: 5,
            half_distance: 3.0,
            sid_lambda: 0.25,
        }),
    };
    let out = rescore(&[c1_input, c2_input], None, &[hist_input], &cfg);
    assert_eq!(out.len(), 2);
    assert_eq!(
        out[0].post_id, "cand-2",
        "与上一页历史同簇且高相似的 cand-1 应当被滑窗排斥至 cand-2 之后"
    );
    // 验证通过 RecommendationQueryPayload::served_history 构建上下文时不 panic
    let query = RecommendationQueryPayload {
        request_id: "req-hist".to_string(),
        decision_id: "00000000-0000-4000-8000-000000000002".to_string(),
        user_id: "viewer-1".to_string(),
        limit: 2,
        served_history: vec![ServedHistoryEntryPayload {
            post_id: "hist-1".to_string(),
            served_at_ms: 1_700_000_000_000,
            position: Some(0),
            source: None,
        }],
        ..Default::default()
    };
    let out_rerank = rerank_candidates(&query, &[hist_cand, c1, c2], &cfg, false, Some(2));
    assert_eq!(out_rerank.candidates.len(), 2);
}
