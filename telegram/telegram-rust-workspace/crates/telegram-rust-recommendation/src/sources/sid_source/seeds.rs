//! 从 `RecommendationQueryPayload` 提取正反馈种子帖 SID 与负反馈排除集合。

use std::collections::{HashMap, HashSet};

use chrono::DateTime;
use serde_json::Value;

use crate::contracts::{ColumnarActionStepPayload, RecommendationQueryPayload};
use crate::state::sid_index::{SID_LEVELS, SidPrefixIndex, SidSeed, seed_key};

/// 从 V3 列式序列、传统行为序列与上下文种子列表中提取正反馈种子，并收集负反馈帖子 ID。
pub(super) fn extract_positive_seeds(
    index: &SidPrefixIndex,
    query: &RecommendationQueryPayload,
    max_seeds: usize,
) -> (Vec<SidSeed>, HashSet<String>) {
    let mut seeds = Vec::new();
    let mut seen_seed_ids = HashSet::new();
    let mut negative_post_ids = HashSet::new();

    // 1. 先从传统/模型行为序列收集负反馈帖子 ID，避免负反馈帖回流作种子或候选
    let legacy_actions = query
        .user_action_sequence
        .as_deref()
        .filter(|seq| !seq.is_empty())
        .or(query.model_user_action_sequence.as_deref())
        .unwrap_or_default();

    let mut ranked_legacy: Vec<(i64, usize, &HashMap<String, Value>)> = Vec::new();
    for (idx, action) in legacy_actions.iter().enumerate() {
        let action_name = action_str(action, &["action", "actionType"])
            .unwrap_or_default()
            .to_ascii_lowercase();
        if is_negative_action_name(&action_name) {
            if let Some(pid) = action_post_id(action) {
                negative_post_ids.insert(pid.to_string());
            }
            continue;
        }
        if is_positive_action_name(&action_name) {
            let ts_ms = parse_action_timestamp_ms(action).unwrap_or(0);
            ranked_legacy.push((ts_ms, idx, action));
        }
    }
    // 时间越近的交互越优先；无时间戳时按序列靠后优先
    ranked_legacy.sort_unstable_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));

    // 2. 优先读取 V3 列式动作序列中的正反馈步（action_type 1..=11 且直接携带 semantic_ids）
    let columnar_steps = if !query.columnar_retrieval_sequence.is_empty() {
        query.columnar_retrieval_sequence.as_slice()
    } else {
        query.columnar_scoring_sequence.as_slice()
    };
    let mut sorted_columnar: Vec<(f32, usize, &ColumnarActionStepPayload)> = columnar_steps
        .iter()
        .enumerate()
        .filter(|(_, step)| is_positive_columnar_action_type(step.action_type))
        .map(|(idx, step)| {
            let delta = if step.time_delta_sec.is_finite() {
                step.time_delta_sec.max(0.0)
            } else {
                f32::MAX
            };
            (delta, idx, step)
        })
        .collect();
    sorted_columnar.sort_unstable_by(|a, b| a.0.total_cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

    for (idx, (_, _, step)) in sorted_columnar.into_iter().enumerate() {
        if seeds.len() >= max_seeds {
            break;
        }
        let Some(codes) = step.semantic_ids else {
            continue;
        };
        let Some(key) = seed_key(&codes) else {
            continue;
        };
        let seed_id = if step.post_id_hash != 0 {
            format!("hash:{}", step.post_id_hash)
        } else {
            format!("col:{idx}")
        };
        if seen_seed_ids.insert(seed_id.clone()) {
            seeds.push(SidSeed {
                post_id: seed_id,
                key,
            });
        }
    }

    // 3. 补充解析 user_action_sequence 中的正反馈帖子及 SID
    for (_, _, action) in ranked_legacy {
        if seeds.len() >= max_seeds {
            break;
        }
        let Some(pid) = action_post_id(action) else {
            continue;
        };
        if negative_post_ids.contains(pid) || seen_seed_ids.contains(pid) {
            continue;
        }
        let Some(codes) = parse_inline_semantic_ids(action).or_else(|| index.lookup_codes(pid))
        else {
            continue;
        };
        let Some(key) = seed_key(&codes) else {
            continue;
        };
        seen_seed_ids.insert(pid.to_string());
        seeds.push(SidSeed {
            post_id: pid.to_string(),
            key,
        });
    }

    // 4. 兜底合并显式传入的 seed_candidate_post_ids
    for pid in &query.seed_candidate_post_ids {
        if seeds.len() >= max_seeds {
            break;
        }
        let trimmed = pid.trim();
        if trimmed.is_empty()
            || negative_post_ids.contains(trimmed)
            || seen_seed_ids.contains(trimmed)
        {
            continue;
        }
        if let Some(codes) = index.lookup_codes(trimmed)
            && let Some(key) = seed_key(&codes)
        {
            seen_seed_ids.insert(trimmed.to_string());
            seeds.push(SidSeed {
                post_id: trimmed.to_string(),
                key,
            });
        }
    }

    (seeds, negative_post_ids)
}

fn is_positive_columnar_action_type(action_type: i32) -> bool {
    // 对齐 ml-services/src/contracts/actions.py ACTION_TYPE_MAP：1(click)..=11(profile_click) 为正反馈
    (1..=11).contains(&action_type)
}

fn is_positive_action_name(action: &str) -> bool {
    matches!(
        action,
        "like"
            | "favorite"
            | "reply"
            | "repost"
            | "retweet"
            | "quote"
            | "click"
            | "tweet_click"
            | "open_link"
            | "profile_click"
            | "share"
            | "video_quality_view"
            | "video_complete"
            | "video_view"
            | "dwell"
            | "follow_author"
            | "follow"
    )
}

fn is_negative_action_name(action: &str) -> bool {
    matches!(
        action,
        "dismiss"
            | "dismiss_post"
            | "hide"
            | "hide_post"
            | "not_interested"
            | "mute_author"
            | "mute"
            | "block_author"
            | "block"
            | "report"
    )
}

fn action_str<'a>(action: &'a HashMap<String, Value>, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| action.get(*key).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn action_post_id(action: &HashMap<String, Value>) -> Option<&str> {
    action_str(
        action,
        &[
            "targetPostId",
            "target_post_id",
            "postId",
            "post_id",
            "modelPostId",
            "model_post_id",
        ],
    )
}

fn parse_action_timestamp_ms(action: &HashMap<String, Value>) -> Option<i64> {
    for key in ["engagedAtMs", "engaged_at_ms", "timestampMs"] {
        if let Some(ms) = action.get(key).and_then(Value::as_i64) {
            return Some(ms);
        }
    }
    for key in ["timestamp", "createdAt", "actionTime"] {
        if let Some(raw) = action.get(key).and_then(Value::as_str)
            && let Ok(dt) = DateTime::parse_from_rfc3339(raw)
        {
            return Some(dt.timestamp_millis());
        }
    }
    None
}

fn parse_inline_semantic_ids(action: &HashMap<String, Value>) -> Option<[i32; SID_LEVELS]> {
    let arr = action
        .get("semanticIds")
        .or_else(|| action.get("semantic_ids"))
        .and_then(Value::as_array)?;
    if arr.len() != SID_LEVELS {
        return None;
    }
    let mut codes = [0i32; SID_LEVELS];
    for (idx, val) in arr.iter().enumerate() {
        let n = val.as_i64()?;
        codes[idx] = i32::try_from(n).ok()?;
    }
    Some(codes)
}
