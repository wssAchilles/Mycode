use std::collections::HashMap;

use telegram_randomized_policy_primitives::{DeterministicOpen53Rng, compute_full_distribution};
use telegram_recommendation_contracts::{decode_hex_32, sha256_hex};

use crate::contracts::RecommendationCandidatePayload;
use crate::serving::stable_order::compare_candidates;

use super::MAX_SLATE_SIZE;

const ONLINE_SLATE_EPOCH_ID: &[u8] = b"online-epsilon-plackett-luce-v1";

/// 在线页级 ε-Plackett-Luce 随机探索入口。
///
/// 使用 `telegram_randomized_policy_primitives::compute_full_distribution` 与确定性
/// `DeterministicOpen53Rng` 对顶部探索槽位（上限 `MAX_SLATE_SIZE = 64`）依次执行无放回采样：
/// - 每一步依据确定性基线顺序构造剩余候选池，将 `(1 - epsilon)` 概率质量置于当前确定性 Top-1，
///   其余 `epsilon` 按温度缩放 softmax（Plackett-Luce）分配；
/// - 将每条选中候选的真实条件选择概率写入 `page_rl_exploration_prob`；
/// - 执行保分集合重映射保持下游分数单调性与尺度不变；
/// - 返回全体被探索槽位的联合选择倾向概率（joint propensity），解锁下游 `logged_randomized`
///   决策日志及 OPE V3/V4 反事实评估；任何非法参数或数值异常均 Fail-Closed 返回 `None` 且不改写原切片。
pub fn apply_online_epsilon_plackett_luce_slate(
    candidates: &mut [RecommendationCandidatePayload],
    epsilon: f64,
    temperature: f64,
    seed_material: &str,
) -> Option<f64> {
    if candidates.len() < 2 {
        return None;
    }
    if !epsilon.is_finite() || epsilon <= 0.0 || epsilon > 1.0 {
        return None;
    }
    if !temperature.is_finite() || temperature <= 0.0 {
        return None;
    }

    let explore_len = candidates.len().min(MAX_SLATE_SIZE);
    if candidates[..explore_len]
        .iter()
        .any(|cand| cand.score.is_some_and(|score| !score.is_finite()))
    {
        return None;
    }

    // 构造确定性基准顺序（确保 index == 0 严格对应确定性 Top-1 候选）。
    let mut remaining: Vec<usize> = (0..explore_len).collect();
    remaining
        .sort_by(|&left, &right| compare_candidates(&candidates[left], &candidates[right], false));

    let original_scores: Vec<Option<f64>> =
        remaining.iter().map(|&idx| candidates[idx].score).collect();
    let original_final_scores: Vec<f64> = remaining
        .iter()
        .map(|&idx| candidates[idx].final_score())
        .collect();

    let mut rng = build_online_rng(candidates, &remaining, epsilon, temperature, seed_material)?;
    let mut picked: Vec<(usize, f64)> = Vec::with_capacity(explore_len);
    let mut joint_propensity = 1.0_f64;

    for _slot in 0..explore_len {
        let logits: Vec<f64> = remaining
            .iter()
            .map(|&idx| candidates[idx].final_score())
            .collect();
        let distribution = compute_full_distribution(&logits, epsilon, temperature).ok()?;
        let draw = rng.next_open53().ok()?.uniform_draw;
        if !draw.is_finite() || draw <= 0.0 || draw >= 1.0 {
            return None;
        }

        let selected_pos = select_from_distribution(&distribution.probabilities, draw)?;
        let conditional_prob = distribution.probabilities[selected_pos].1;
        if !conditional_prob.is_finite() || conditional_prob <= 0.0 || conditional_prob > 1.0 {
            return None;
        }
        joint_propensity *= conditional_prob;
        if !joint_propensity.is_finite() || joint_propensity <= 0.0 {
            return None;
        }

        let orig_idx = remaining.remove(selected_pos);
        picked.push((orig_idx, conditional_prob));
    }

    // 全部步骤成功后原子性写回重排结果与概率字段。
    let mut reordered = Vec::with_capacity(explore_len);
    for (slot, &(orig_idx, conditional_prob)) in picked.iter().enumerate() {
        let mut candidate = candidates[orig_idx].clone();
        let pre_exploration_score = candidate.score;
        if original_scores[slot].is_some() || candidate.score.is_some() {
            candidate.score = Some(original_final_scores[slot]);
        }
        candidate.page_rl_exploration_prob = Some(conditional_prob);

        let breakdown = candidate.score_breakdown.get_or_insert_with(HashMap::new);
        if let Some(raw_score) = pre_exploration_score {
            breakdown.insert("preExplorationScore".to_string(), raw_score);
        }
        breakdown.insert("pageRlExplorationProb".to_string(), conditional_prob);
        reordered.push(candidate);
    }

    for (slot, candidate) in reordered.into_iter().enumerate() {
        candidates[slot] = candidate;
    }

    Some(joint_propensity)
}

/// 根据混合分布 CDF 定位落点索引（末位强制收口为 1.0 以抵消浮点截断误差）。
fn select_from_distribution(probabilities: &[(f64, f64)], draw: f64) -> Option<usize> {
    let mut cumulative = 0.0_f64;
    for (index, &(_, mixed_prob)) in probabilities.iter().enumerate() {
        cumulative = if index + 1 == probabilities.len() {
            1.0
        } else {
            cumulative + mixed_prob
        };
        if !cumulative.is_finite() {
            return None;
        }
        if draw < cumulative {
            return Some(index);
        }
    }
    None
}

/// 基于 `seed_material`、候选池和策略超参构造密码学域分离的确定性 Open53 RNG。
fn build_online_rng(
    candidates: &[RecommendationCandidatePayload],
    baseline_order: &[usize],
    epsilon: f64,
    temperature: f64,
    seed_material: &str,
) -> Option<DeterministicOpen53Rng> {
    let seed_hex = sha256_hex(seed_material.as_bytes());
    let seed_bytes = decode_hex_32("onlineSlateSeed", &seed_hex).ok()?;

    let mut pool_material = String::with_capacity(baseline_order.len() * 32);
    for &idx in baseline_order {
        pool_material.push_str(&candidates[idx].post_id);
        pool_material.push(':');
        pool_material.push_str(&format!("{:.9}", candidates[idx].final_score()));
        pool_material.push(';');
    }
    let pool_hex = sha256_hex(pool_material.as_bytes());
    let pool_sha = decode_hex_32("onlineSlatePool", &pool_hex).ok()?;

    let config_material = format!(
        "eps={:.12};tau={:.12};len={}",
        epsilon,
        temperature,
        baseline_order.len()
    );
    let config_hex = sha256_hex(config_material.as_bytes());
    let config_sha = decode_hex_32("onlineSlateConfig", &config_hex).ok()?;

    let decision_id_bytes: &[u8] = if seed_material.trim().is_empty() {
        b"online-randomized-slate-default"
    } else {
        seed_material.as_bytes()
    };

    DeterministicOpen53Rng::from_seed_and_context(
        &seed_bytes,
        ONLINE_SLATE_EPOCH_ID,
        decision_id_bytes,
        &seed_bytes,
        &pool_sha,
        &config_sha,
    )
    .ok()
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use telegram_randomized_policy_primitives::compute_full_distribution;

    use crate::contracts::RecommendationCandidatePayload;

    use super::apply_online_epsilon_plackett_luce_slate;

    fn make_candidate(post_id: &str, score: f64) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            author_id: format!("author-{post_id}"),
            content: "online slate candidate".to_string(),
            created_at: Utc::now(),
            score: Some(score),
            weighted_score: Some(score),
            pipeline_score: Some(score),
            ..Default::default()
        }
    }

    #[test]
    fn online_epsilon_plackett_luce_writes_propensities_and_matches_joint_product() {
        let mut candidates = vec![
            make_candidate("p1", 3.0),
            make_candidate("p2", 2.0),
            make_candidate("p3", 1.0),
            make_candidate("p4", 0.5),
        ];
        let mut replay = candidates.clone();

        let joint = apply_online_epsilon_plackett_luce_slate(
            &mut candidates,
            0.35,
            1.0,
            "decision-1:req-1:user-1",
        )
        .expect("合法在线探索应返回联合 propensity");
        let replay_joint = apply_online_epsilon_plackett_luce_slate(
            &mut replay,
            0.35,
            1.0,
            "decision-1:req-1:user-1",
        )
        .expect("相同种子应具备确定性可重放性");

        assert!((joint - replay_joint).abs() < 1e-12);
        assert_eq!(
            candidates.iter().map(|c| &c.post_id).collect::<Vec<_>>(),
            replay.iter().map(|c| &c.post_id).collect::<Vec<_>>()
        );
        assert!(joint > 0.0 && joint <= 1.0);

        let product: f64 = candidates
            .iter()
            .map(|c| {
                c.page_rl_exploration_prob
                    .expect("每条探索槽位必须写入条件概率")
            })
            .product();
        assert!((joint - product).abs() < 1e-12);

        // 验证保分重映射保持单调降序分值尺度
        for w in candidates.windows(2) {
            assert!(w[0].final_score() >= w[1].final_score());
        }
        assert_eq!(
            candidates.last().unwrap().page_rl_exploration_prob,
            Some(1.0)
        );
    }

    #[test]
    fn online_epsilon_plackett_luce_first_step_matches_compute_full_distribution() {
        let base = vec![
            make_candidate("p1", 2.5),
            make_candidate("p2", 1.5),
            make_candidate("p3", 0.5),
        ];
        let dist = compute_full_distribution(&[2.5, 1.5, 0.5], 0.5, 1.0).unwrap();
        let expected_by_id = [
            ("p1", dist.probabilities[0].1),
            ("p2", dist.probabilities[1].1),
            ("p3", dist.probabilities[2].1),
        ];

        let mut seen_non_top1 = false;
        for seed_idx in 0..40 {
            let mut slate = base.clone();
            let seed = format!("seed-probe-{seed_idx}");
            let joint = apply_online_epsilon_plackett_luce_slate(&mut slate, 0.5, 1.0, &seed)
                .expect("valid exploration");
            assert!(joint > 0.0 && joint <= 1.0);
            let first = &slate[0];
            let expected_prob = expected_by_id
                .iter()
                .find(|&&(id, _)| id == first.post_id)
                .unwrap()
                .1;
            assert!((first.page_rl_exploration_prob.unwrap() - expected_prob).abs() < 1e-12);
            if first.post_id != "p1" {
                seen_non_top1 = true;
            }
        }
        assert!(
            seen_non_top1,
            "epsilon=0.5 在多次不同种子采样下应能探索非 Top-1 候选"
        );
    }

    #[test]
    fn online_epsilon_plackett_luce_fails_closed_on_invalid_or_small_input() {
        let mut single = vec![make_candidate("p1", 1.0)];
        assert!(apply_online_epsilon_plackett_luce_slate(&mut single, 0.2, 1.0, "seed").is_none());
        assert!(single[0].page_rl_exploration_prob.is_none());

        let mut pair = vec![make_candidate("p1", 2.0), make_candidate("p2", 1.0)];
        assert!(apply_online_epsilon_plackett_luce_slate(&mut pair, 0.0, 1.0, "seed").is_none());
        assert!(apply_online_epsilon_plackett_luce_slate(&mut pair, 1.2, 1.0, "seed").is_none());
        assert!(apply_online_epsilon_plackett_luce_slate(&mut pair, 0.2, 0.0, "seed").is_none());
        assert!(pair[0].page_rl_exploration_prob.is_none());
        assert_eq!(pair[0].post_id, "p1");
    }
}
