use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use serde_json::Value;

use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};
use crate::news_trends::core::normalizer::normalize_keyword;

#[derive(Debug, Clone, Copy, Default)]
pub struct AffinitySummary {
    pub score: f64,
    pub positive_score: f64,
    pub negative_score: f64,
    pub exposure_score: f64,
    pub positive_actions: usize,
    pub negative_actions: usize,
    pub exposure_actions: usize,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct CandidateActionMatch {
    pub author_affinity: f64,
    pub topic_affinity: f64,
    pub source_affinity: f64,
    pub conversation_affinity: f64,
    pub negative_feedback: f64,
    pub delivery_fatigue: f64,
    pub personalized_strength: f64,
    pub positive_actions: usize,
    pub negative_actions: usize,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct TemporalActionSummary {
    pub short_positive: f64,
    pub day_positive: f64,
    pub week_positive: f64,
    pub month_positive: f64,
    pub short_negative: f64,
    pub day_negative: f64,
    pub week_negative: f64,
    pub short_exposure: f64,
    pub day_exposure: f64,
    pub week_exposure: f64,
    pub positive_actions: usize,
    pub negative_actions: usize,
    pub exposure_actions: usize,
}

impl TemporalActionSummary {
    pub fn short_interest(&self) -> f64 {
        clamp01(self.short_positive * 0.65 + self.day_positive * 0.35)
    }

    pub fn stable_interest(&self) -> f64 {
        clamp01(self.week_positive * 0.58 + self.month_positive * 0.42)
    }

    pub fn negative_pressure(&self) -> f64 {
        clamp01(self.short_negative * 0.52 + self.day_negative * 0.32 + self.week_negative * 0.16)
    }

    pub fn exposure_pressure(&self) -> f64 {
        clamp01(self.short_exposure * 0.5 + self.day_exposure * 0.33 + self.week_exposure * 0.17)
    }

    fn update(&mut self, class: ActionClass, value: f64, age_hours: f64) {
        let normalized = clamp01(value / 8.0);
        match class {
            ActionClass::Positive => {
                self.positive_actions += 1;
                if age_hours <= 1.0 {
                    self.short_positive += normalized;
                }
                if age_hours <= 24.0 {
                    self.day_positive += normalized;
                }
                if age_hours <= 168.0 {
                    self.week_positive += normalized;
                }
                if age_hours <= 720.0 {
                    self.month_positive += normalized;
                }
            }
            ActionClass::Negative => {
                self.negative_actions += 1;
                if age_hours <= 1.0 {
                    self.short_negative += normalized;
                }
                if age_hours <= 24.0 {
                    self.day_negative += normalized;
                }
                if age_hours <= 168.0 {
                    self.week_negative += normalized;
                }
            }
            ActionClass::Exposure => {
                self.exposure_actions += 1;
                if age_hours <= 1.0 {
                    self.short_exposure += normalized;
                }
                if age_hours <= 24.0 {
                    self.day_exposure += normalized;
                }
                if age_hours <= 168.0 {
                    self.week_exposure += normalized;
                }
            }
            ActionClass::Neutral => {}
        }
    }

    fn finalize(&mut self) {
        self.short_positive = clamp01(self.short_positive);
        self.day_positive = clamp01(self.day_positive / 1.4);
        self.week_positive = clamp01(self.week_positive / 2.6);
        self.month_positive = clamp01(self.month_positive / 4.4);
        self.short_negative = clamp01(self.short_negative);
        self.day_negative = clamp01(self.day_negative / 1.3);
        self.week_negative = clamp01(self.week_negative / 2.4);
        self.short_exposure = clamp01(self.short_exposure);
        self.day_exposure = clamp01(self.day_exposure / 2.0);
        self.week_exposure = clamp01(self.week_exposure / 4.0);
    }
}

#[derive(Debug, Clone, Default)]
pub struct UserActionProfile {
    authors: HashMap<String, AffinitySummary>,
    clusters: HashMap<String, AffinitySummary>,
    sources: HashMap<String, AffinitySummary>,
    conversations: HashMap<String, AffinitySummary>,
    keywords: HashMap<String, AffinitySummary>,
    post_negative: HashMap<String, f64>,
    post_exposure: HashMap<String, f64>,
    pub temporal: TemporalActionSummary,
    pub action_count: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ActionClass {
    Positive,
    Negative,
    Exposure,
    Neutral,
}

#[derive(Debug, Clone, Copy)]
struct ActionWeight {
    class: ActionClass,
    weight: f64,
}

impl UserActionProfile {
    pub fn from_query(query: &RecommendationQueryPayload) -> Self {
        let mut profile = Self::default();
        let primary_actions = query.user_action_sequence.as_deref().unwrap_or_default();
        let fallback_actions = query
            .model_user_action_sequence
            .as_deref()
            .unwrap_or_default();
        let actions = if primary_actions.is_empty() {
            fallback_actions
        } else {
            primary_actions
        };
        let now = Utc::now();

        for action in actions {
            profile.ingest_action(action, now);
        }

        profile.finalize_scores();
        profile
    }

    pub fn match_candidate(
        &self,
        candidate: &RecommendationCandidatePayload,
    ) -> CandidateActionMatch {
        let author = self
            .authors
            .get(&candidate.author_id)
            .copied()
            .unwrap_or_default();
        let cluster = candidate_cluster_key(candidate)
            .and_then(|key| self.clusters.get(&key).copied())
            .unwrap_or_default();
        let source = candidate_source_key(candidate)
            .and_then(|key| self.sources.get(&key).copied())
            .unwrap_or_default();
        let conversation = candidate
            .conversation_id
            .as_ref()
            .and_then(|key| self.conversations.get(key).copied())
            .unwrap_or_default();
        let keyword = candidate_keywords(candidate)
            .into_iter()
            .filter_map(|key| self.keywords.get(&key).copied())
            .max_by(|left, right| {
                left.score
                    .partial_cmp(&right.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
            .unwrap_or_default();

        let post_negative = related_candidate_ids(candidate)
            .into_iter()
            .filter_map(|key| self.post_negative.get(&key).copied())
            .fold(0.0_f64, f64::max);
        let post_exposure = related_candidate_ids(candidate)
            .into_iter()
            .filter_map(|key| self.post_exposure.get(&key).copied())
            .fold(0.0_f64, f64::max);

        let topic_affinity = cluster.score.max(keyword.score);
        let negative_feedback = clamp01(
            post_negative
                .max(author.negative_score * 0.92)
                .max(cluster.negative_score * 0.76)
                .max(keyword.negative_score * 0.68)
                .max(source.negative_score * 0.48)
                .max(conversation.negative_score * 0.78),
        );
        let delivery_fatigue = clamp01(
            post_exposure
                .max(author.exposure_score * 0.28)
                .max(cluster.exposure_score * 0.24)
                .max(source.exposure_score * 0.2)
                .max(conversation.exposure_score * 0.3),
        );
        let personalized_strength = clamp01(
            author.score.max(0.0) * 0.5
                + topic_affinity.max(0.0) * 0.24
                + source.score.max(0.0) * 0.12
                + conversation.score.max(0.0) * 0.14,
        );

        CandidateActionMatch {
            author_affinity: author.score,
            topic_affinity,
            source_affinity: source.score,
            conversation_affinity: conversation.score,
            negative_feedback,
            delivery_fatigue,
            personalized_strength,
            positive_actions: author.positive_actions
                + cluster.positive_actions
                + source.positive_actions
                + conversation.positive_actions
                + keyword.positive_actions,
            negative_actions: author.negative_actions
                + cluster.negative_actions
                + source.negative_actions
                + conversation.negative_actions
                + keyword.negative_actions,
        }
    }

    pub fn temporal_summary(&self) -> TemporalActionSummary {
        self.temporal
    }

    fn ingest_action(&mut self, action: &HashMap<String, Value>, now: DateTime<Utc>) {
        let action_name = action_string(action, &["action"])
            .unwrap_or_default()
            .to_lowercase();
        let action_weight = action_weight(&action_name, action);
        if action_weight.class == ActionClass::Neutral || action_weight.weight <= 0.0 {
            return;
        }

        let age_days = action_age_days(action, now).unwrap_or(0.0).min(60.0);
        let age_hours = age_days * 24.0;
        let half_life_hours = action_half_life_hours(&action_name, action_weight.class);
        let recency = 0.5_f64.powf(age_hours / half_life_hours);
        let position_quality = rank_quality(action);
        let value = action_weight.weight * recency * position_quality;
        if value <= 0.0 {
            return;
        }

        self.action_count += 1;
        self.temporal.update(action_weight.class, value, age_hours);

        if let Some(author_id) = action_string(action, &["targetAuthorId", "target_author_id"]) {
            update_affinity(
                self.authors.entry(author_id).or_default(),
                action_weight.class,
                value,
            );
        }
        if let Some(cluster_id) = action_number_string(
            action,
            &[
                "targetClusterId",
                "target_cluster_id",
                "clusterId",
                "cluster_id",
                "newsClusterId",
            ],
        ) {
            update_affinity(
                self.clusters.entry(cluster_id).or_default(),
                action_weight.class,
                value,
            );
        }
        if let Some(source) = action_string(
            action,
            &[
                "targetSource",
                "target_source",
                "source",
                "recallSource",
                "recall_source",
            ],
        )
        .and_then(|source| normalize_source_key(&source))
        {
            update_affinity(
                self.sources.entry(source).or_default(),
                action_weight.class,
                value,
            );
        }
        if let Some(conversation_id) = action_string(
            action,
            &[
                "targetConversationId",
                "target_conversation_id",
                "conversationId",
            ],
        ) {
            update_affinity(
                self.conversations.entry(conversation_id).or_default(),
                action_weight.class,
                value,
            );
        }
        for keyword in action_keywords(action) {
            update_affinity(
                self.keywords.entry(keyword).or_default(),
                action_weight.class,
                value,
            );
        }

        for post_id in action_post_ids(action) {
            match action_weight.class {
                ActionClass::Negative => {
                    let entry = self.post_negative.entry(post_id).or_default();
                    *entry = entry.max(clamp01(value / 6.0));
                }
                ActionClass::Exposure => {
                    let entry = self.post_exposure.entry(post_id).or_default();
                    *entry = entry.max(clamp01(value / 4.0));
                }
                _ => {}
            }
        }
    }

    fn finalize_scores(&mut self) {
        for map in [
            &mut self.authors,
            &mut self.clusters,
            &mut self.sources,
            &mut self.conversations,
            &mut self.keywords,
        ] {
            for summary in map.values_mut() {
                finalize_affinity(summary);
            }
        }
        self.temporal.finalize();
    }
}

fn update_affinity(summary: &mut AffinitySummary, class: ActionClass, value: f64) {
    match class {
        ActionClass::Positive => {
            summary.positive_score += value;
            summary.positive_actions += 1;
        }
        ActionClass::Negative => {
            summary.negative_score += value;
            summary.negative_actions += 1;
        }
        ActionClass::Exposure => {
            summary.exposure_score += value;
            summary.exposure_actions += 1;
        }
        ActionClass::Neutral => {}
    }
}

fn finalize_affinity(summary: &mut AffinitySummary) {
    let positive = if summary.positive_actions == 0 {
        0.0
    } else {
        clamp01(summary.positive_score / (7.0 + summary.positive_actions as f64 * 0.42))
    };
    let negative = if summary.negative_actions == 0 {
        0.0
    } else {
        clamp01(summary.negative_score / (4.8 + summary.negative_actions as f64 * 0.24))
    };
    let exposure = if summary.exposure_actions == 0 {
        0.0
    } else {
        clamp01(summary.exposure_score / (10.0 + summary.exposure_actions as f64 * 0.6))
    };

    let repeated_positive_bonus = match summary.positive_actions {
        0 | 1 => 0.0,
        2 => 0.03,
        _ => 0.07,
    };
    let repeated_negative_bonus = if summary.negative_actions >= 2 {
        0.06
    } else {
        0.0
    };
    summary.positive_score = clamp01(positive + repeated_positive_bonus);
    summary.negative_score = clamp01(negative + repeated_negative_bonus);
    summary.exposure_score = exposure;
    summary.score =
        (summary.positive_score - summary.negative_score * 1.2 - exposure * 0.18).clamp(-1.0, 1.0);
}

fn action_weight(action: &str, payload: &HashMap<String, Value>) -> ActionWeight {
    match action {
        "like" => positive(2.4),
        "reply" => positive(4.2),
        "repost" => positive(3.5),
        "quote" => positive(3.8),
        "click" => positive(1.1),
        "profile_click" => positive(2.3),
        "share" => positive(4.0),
        "video_quality_view" => positive(1.8),
        "video_view" => positive(0.7),
        "dwell" => positive(
            1.0 + number_value(payload, &["dwellTimeMs", "dwell_time_ms"]).min(18_000.0) / 9_000.0,
        ),
        "dismiss" => negative(2.2),
        "not_interested" => negative(3.4),
        "mute_author" => negative(5.2),
        "block_author" | "block" => negative(8.0),
        "report" => negative(7.5),
        "impression" => exposure(0.5),
        "delivery" => exposure(0.32),
        _ => ActionWeight {
            class: ActionClass::Neutral,
            weight: 0.0,
        },
    }
}

fn action_half_life_hours(action: &str, class: ActionClass) -> f64 {
    match action {
        "reply" | "quote" | "repost" | "share" => 336.0,
        "like" => 168.0,
        "profile_click" => 96.0,
        "dwell" => 72.0,
        "click" => 48.0,
        "video_quality_view" | "video_view" => 36.0,
        "dismiss" | "not_interested" => 720.0,
        "mute_author" | "block_author" | "block" | "report" => 1_440.0,
        "impression" | "delivery" => 24.0,
        _ => match class {
            ActionClass::Positive => 168.0,
            ActionClass::Negative => 720.0,
            ActionClass::Exposure => 24.0,
            ActionClass::Neutral => 1.0,
        },
    }
}

fn positive(weight: f64) -> ActionWeight {
    ActionWeight {
        class: ActionClass::Positive,
        weight,
    }
}

fn negative(weight: f64) -> ActionWeight {
    ActionWeight {
        class: ActionClass::Negative,
        weight,
    }
}

fn exposure(weight: f64) -> ActionWeight {
    ActionWeight {
        class: ActionClass::Exposure,
        weight,
    }
}

fn rank_quality(action: &HashMap<String, Value>) -> f64 {
    let rank = number_value(action, &["rank"]);
    if rank <= 0.0 {
        return 1.0;
    }
    (1.12 - (rank - 1.0).min(30.0) * 0.012).clamp(0.78, 1.12)
}

fn action_age_days(action: &HashMap<String, Value>, now: DateTime<Utc>) -> Option<f64> {
    let timestamp = action
        .get("timestamp")
        .or_else(|| action.get("createdAt"))
        .and_then(parse_timestamp)?;
    Some(
        now.signed_duration_since(timestamp.with_timezone(&Utc))
            .num_seconds()
            .max(0) as f64
            / 86_400.0,
    )
}

fn parse_timestamp(value: &Value) -> Option<DateTime<chrono::FixedOffset>> {
    if let Some(text) = value.as_str() {
        return DateTime::parse_from_rfc3339(text).ok();
    }
    value
        .as_object()
        .and_then(|object| object.get("$date").or_else(|| object.get("date")))
        .and_then(Value::as_str)
        .and_then(|text| DateTime::parse_from_rfc3339(text).ok())
}

fn action_post_ids(action: &HashMap<String, Value>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for key in [
        "targetPostId",
        "target_post_id",
        "modelPostId",
        "model_post_id",
        "targetExternalId",
        "target_external_id",
    ] {
        if let Some(id) = action_string(action, &[key]) {
            if seen.insert(id.clone()) {
                out.push(id);
            }
        }
    }
    if let Some(cluster_id) = action_number_string(
        action,
        &[
            "targetClusterId",
            "target_cluster_id",
            "clusterId",
            "cluster_id",
            "newsClusterId",
        ],
    ) {
        let key = format!("news:cluster:{cluster_id}");
        if seen.insert(key.clone()) {
            out.push(key);
        }
    }
    out
}

fn related_candidate_ids(candidate: &RecommendationCandidatePayload) -> Vec<String> {
    let mut ids = vec![
        candidate.model_post_id.clone(),
        Some(candidate.post_id.clone()),
        candidate.original_post_id.clone(),
        candidate.reply_to_post_id.clone(),
        candidate.conversation_id.clone(),
    ];
    if let Some(metadata) = candidate.news_metadata.as_ref() {
        ids.push(metadata.external_id.clone());
        if let Some(cluster_id) = metadata.cluster_id {
            ids.push(Some(format!("news:cluster:{cluster_id}")));
        }
    }
    let mut seen = HashSet::new();
    ids.into_iter()
        .flatten()
        .filter(|id| seen.insert(id.clone()))
        .collect()
}

fn candidate_cluster_key(candidate: &RecommendationCandidatePayload) -> Option<String> {
    candidate
        .news_metadata
        .as_ref()
        .and_then(|metadata| metadata.cluster_id)
        .map(|cluster_id| cluster_id.to_string())
}

fn candidate_source_key(candidate: &RecommendationCandidatePayload) -> Option<String> {
    candidate
        .news_metadata
        .as_ref()
        .and_then(|metadata| {
            metadata
                .source_url
                .as_deref()
                .or(metadata.url.as_deref())
                .and_then(normalize_source_key)
                .or_else(|| metadata.source.as_deref().and_then(normalize_source_key))
        })
        .or_else(|| {
            candidate
                .recall_source
                .as_deref()
                .and_then(normalize_source_key)
        })
}

fn candidate_keywords(candidate: &RecommendationCandidatePayload) -> Vec<String> {
    let text = format!(
        "{} {} {}",
        candidate.content,
        candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.title.as_deref())
            .unwrap_or_default(),
        candidate
            .news_metadata
            .as_ref()
            .and_then(|metadata| metadata.summary.as_deref())
            .unwrap_or_default()
    );
    text.split_whitespace()
        .filter_map(normalize_keyword)
        .take(12)
        .collect()
}

fn action_keywords(action: &HashMap<String, Value>) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for key in ["targetKeywords", "target_keywords", "keywords"] {
        if let Some(values) = action.get(key).and_then(Value::as_array) {
            for value in values {
                if let Some(keyword) = value.as_str().and_then(normalize_keyword) {
                    if seen.insert(keyword.clone()) {
                        out.push(keyword);
                    }
                }
            }
        }
    }
    if out.is_empty() {
        for key in ["targetTitle", "target_title", "content", "actionText"] {
            if let Some(text) = action_string(action, &[key]) {
                for keyword in text.split_whitespace().filter_map(normalize_keyword) {
                    if seen.insert(keyword.clone()) {
                        out.push(keyword);
                    }
                    if out.len() >= 12 {
                        return out;
                    }
                }
            }
        }
    }
    out
}

fn action_number_string(action: &HashMap<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        let Some(value) = action.get(*key) else {
            continue;
        };
        if let Some(text) = value.as_str().filter(|value| !value.trim().is_empty()) {
            return Some(text.to_string());
        }
        if let Some(number) = value.as_i64() {
            return Some(number.to_string());
        }
        if let Some(number) = value.as_u64() {
            return Some(number.to_string());
        }
    }
    None
}

fn action_string(action: &HashMap<String, Value>, keys: &[&str]) -> Option<String> {
    for key in keys {
        let Some(value) = action.get(*key) else {
            continue;
        };
        if let Some(as_string) = value.as_str().filter(|value| !value.trim().is_empty()) {
            return Some(as_string.to_string());
        }
        if let Some(as_oid) = value
            .as_object()
            .and_then(|object| object.get("$oid").or_else(|| object.get("oid")))
            .and_then(Value::as_str)
        {
            return Some(as_oid.to_string());
        }
    }
    None
}

fn number_value(action: &HashMap<String, Value>, keys: &[&str]) -> f64 {
    for key in keys {
        let Some(value) = action.get(*key) else {
            continue;
        };
        if let Some(number) = value.as_f64().filter(|value| value.is_finite()) {
            return number;
        }
        if let Some(number) = value.as_str().and_then(|text| text.parse::<f64>().ok()) {
            if number.is_finite() {
                return number;
            }
        }
    }
    0.0
}

fn normalize_source_key(value: &str) -> Option<String> {
    let trimmed = value.trim().to_lowercase();
    if trimmed.is_empty() {
        return None;
    }
    let host_start = trimmed.find("://").map_or(0, |index| index + 3);
    let host = trimmed[host_start..]
        .split('/')
        .next()
        .unwrap_or("")
        .split('@')
        .next_back()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim_start_matches("www.")
        .to_string();
    if host.is_empty() {
        Some(trimmed)
    } else {
        Some(host)
    }
}

fn clamp01(value: f64) -> f64 {
    value.max(0.0).min(1.0)
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, TimeZone, Utc};
    use serde_json::json;

    use crate::contracts::{CandidateNewsMetadataPayload, RecommendationCandidatePayload};

    use super::*;

    fn candidate(author_id: &str) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: "post-1".to_string(),
            model_post_id: Some("model-1".to_string()),
            author_id: author_id.to_string(),
            content: "Rust recommendation ranking".to_string(),
            created_at: Utc.with_ymd_and_hms(2026, 4, 20, 0, 0, 0).unwrap(),
            conversation_id: Some("conversation-1".to_string()),
            is_reply: false,
            reply_to_post_id: None,
            is_repost: false,
            original_post_id: None,
            in_network: Some(false),
            recall_source: Some("NewsAnnSource".to_string()),
            retrieval_lane: Some("interest".to_string()),
            interest_pool_kind: None,
            secondary_recall_sources: None,
            has_video: None,
            has_image: None,
            video_duration_sec: None,
            media: None,
            like_count: None,
            comment_count: None,
            repost_count: None,
            view_count: None,
            author_username: None,
            author_avatar_url: None,
            author_affinity_score: None,
            phoenix_scores: None,
            action_scores: None,
            ranking_signals: None,
            recall_evidence: None,
            selection_pool: None,
            selection_reason: None,
            score_contract_version: None,
            score_breakdown_version: None,
            weighted_score: None,
            score: None,
            is_liked_by_user: None,
            is_reposted_by_user: None,
            is_nsfw: None,
            vf_result: None,
            is_news: Some(true),
            news_metadata: Some(CandidateNewsMetadataPayload {
                title: Some("Rust ranking release".to_string()),
                source: Some("BBC".to_string()),
                source_url: Some("https://www.bbc.com/news/rust".to_string()),
                cluster_id: Some(42),
                ..CandidateNewsMetadataPayload::default()
            }),
            is_pinned: None,
            score_breakdown: None,
            pipeline_score: None,
            graph_score: None,
            graph_path: None,
            graph_recall_type: None,
        }
    }

    #[test]
    fn profile_matches_author_cluster_source_and_keywords() {
        let query = RecommendationQueryPayload {
            request_id: "req".to_string(),
            user_id: "viewer".to_string(),
            limit: 10,
            cursor: None,
            in_network_only: false,
            seen_ids: vec![],
            served_ids: vec![],
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: None,
            user_state_context: None,
            user_action_sequence: Some(vec![HashMap::from([
                ("action".to_string(), json!("reply")),
                ("targetAuthorId".to_string(), json!("author-a")),
                ("targetClusterId".to_string(), json!(42)),
                ("targetSource".to_string(), json!("https://bbc.com/news/1")),
                ("targetConversationId".to_string(), json!("conversation-1")),
                ("targetKeywords".to_string(), json!(["rust", "ranking"])),
                ("timestamp".to_string(), json!("2026-04-20T00:00:00Z")),
            ])]),
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: None,
        };

        let profile = UserActionProfile::from_query(&query);
        let action_match = profile.match_candidate(&candidate("author-a"));

        assert!(action_match.author_affinity > 0.0);
        assert!(action_match.topic_affinity > 0.0);
        assert!(action_match.source_affinity > 0.0);
        assert!(action_match.conversation_affinity > 0.0);
        assert!(action_match.personalized_strength > 0.0);
    }

    #[test]
    fn negative_author_feedback_carries_to_candidate() {
        let query = RecommendationQueryPayload {
            request_id: "req".to_string(),
            user_id: "viewer".to_string(),
            limit: 10,
            cursor: None,
            in_network_only: false,
            seen_ids: vec![],
            served_ids: vec![],
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: None,
            user_state_context: None,
            user_action_sequence: Some(vec![HashMap::from([
                ("action".to_string(), json!("block_author")),
                ("targetAuthorId".to_string(), json!("author-a")),
                ("timestamp".to_string(), json!("2026-04-20T00:00:00Z")),
            ])]),
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: None,
        };

        let profile = UserActionProfile::from_query(&query);
        let action_match = profile.match_candidate(&candidate("author-a"));

        assert!(action_match.author_affinity < 0.0);
        assert!(action_match.negative_feedback > 0.0);
    }

    #[test]
    fn temporal_summary_separates_short_and_stable_interest() {
        let now = Utc::now();
        let query = RecommendationQueryPayload {
            request_id: "req".to_string(),
            user_id: "viewer".to_string(),
            limit: 10,
            cursor: None,
            in_network_only: false,
            seen_ids: vec![],
            served_ids: vec![],
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: None,
            user_state_context: None,
            user_action_sequence: Some(vec![
                HashMap::from([
                    ("action".to_string(), json!("like")),
                    ("targetAuthorId".to_string(), json!("author-a")),
                    ("timestamp".to_string(), json!(now.to_rfc3339())),
                ]),
                HashMap::from([
                    ("action".to_string(), json!("reply")),
                    ("targetAuthorId".to_string(), json!("author-b")),
                    (
                        "timestamp".to_string(),
                        json!((now - Duration::days(6)).to_rfc3339()),
                    ),
                ]),
            ]),
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: None,
        };

        let profile = UserActionProfile::from_query(&query);
        let temporal = profile.temporal_summary();

        assert!(temporal.short_interest() > 0.0);
        assert!(temporal.stable_interest() > 0.0);
        assert!(temporal.short_interest() >= temporal.stable_interest() * 0.4);
    }

    #[test]
    fn action_half_life_keeps_negative_feedback_longer_than_clicks() {
        assert!(
            action_half_life_hours("block_author", ActionClass::Negative)
                > action_half_life_hours("click", ActionClass::Positive)
        );
        assert!(
            action_half_life_hours("dismiss", ActionClass::Negative)
                > action_half_life_hours("delivery", ActionClass::Exposure)
        );
    }

    #[test]
    fn recent_click_affinity_is_stronger_than_stale_click_affinity() {
        let recent_timestamp = Utc::now() - Duration::hours(2);
        let stale_timestamp = Utc::now() - Duration::days(14);
        let build_query = |timestamp: chrono::DateTime<Utc>| RecommendationQueryPayload {
            request_id: "req".to_string(),
            user_id: "viewer".to_string(),
            limit: 10,
            cursor: None,
            in_network_only: false,
            seen_ids: vec![],
            served_ids: vec![],
            is_bottom_request: false,
            client_app_id: None,
            country_code: None,
            language_code: None,
            user_features: None,
            embedding_context: None,
            user_state_context: None,
            user_action_sequence: Some(vec![HashMap::from([
                ("action".to_string(), json!("click")),
                ("targetAuthorId".to_string(), json!("author-a")),
                ("timestamp".to_string(), json!(timestamp.to_rfc3339())),
            ])]),
            news_history_external_ids: None,
            model_user_action_sequence: None,
            experiment_context: None,
            ranking_policy: None,
        };

        let recent_match = UserActionProfile::from_query(&build_query(recent_timestamp))
            .match_candidate(&candidate("author-a"));
        let stale_match = UserActionProfile::from_query(&build_query(stale_timestamp))
            .match_candidate(&candidate("author-a"));

        assert!(recent_match.author_affinity > stale_match.author_affinity);
    }
}
