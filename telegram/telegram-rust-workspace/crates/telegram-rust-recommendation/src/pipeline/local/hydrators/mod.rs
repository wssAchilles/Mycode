mod demographics;
mod engagement_counts;
mod following_replied_users;
mod has_media;
mod impressed_posts;
mod ip;
mod mutual_follow;
mod mutual_follow_jaccard;
mod past_request_timestamps;
mod quote;
mod subscribed_user_ids;
mod tweet_type_metrics;
mod video_duration;

pub use demographics::demographics_hydrator;
pub use engagement_counts::engagement_counts_hydrator;
pub use following_replied_users::following_replied_users_hydrator;
pub use has_media::has_media_hydrator;
pub use impressed_posts::impressed_posts_hydrator;
pub use ip::ip_hydrator;
pub use mutual_follow::mutual_follow_hydrator;
pub use mutual_follow_jaccard::mutual_follow_jaccard_hydrator;
pub use past_request_timestamps::past_request_timestamps_hydrator;
pub use quote::quote_hydrator;
pub use subscribed_user_ids::subscribed_user_ids_hydrator;
pub use tweet_type_metrics::tweet_type_metrics_hydrator;
pub use video_duration::video_duration_hydrator;

use std::collections::{HashMap, HashSet};

use telegram_component_primitives::candidate_hydrators::{
    ENGAGEMENT_COUNTS_CANDIDATE_HYDRATOR, FOLLOWING_REPLIED_USERS_CANDIDATE_HYDRATOR,
    HAS_MEDIA_CANDIDATE_HYDRATOR, MUTUAL_FOLLOW_JACCARD_CANDIDATE_HYDRATOR,
    QUOTE_CANDIDATE_HYDRATOR, TWEET_TYPE_METRICS_CANDIDATE_HYDRATOR,
    VIDEO_DURATION_CANDIDATE_HYDRATOR,
};
use telegram_pipeline_primitives::{
    PIPELINE_STAGE_KIND_HYDRATOR, annotate_rust_owned_stage_detail, annotate_stage_contract_detail,
};

use crate::contracts::{
    RecommendationCandidatePayload, RecommendationQueryPayload, RecommendationStagePayload,
};

pub struct LocalQueryHydratorExecution {
    pub query: RecommendationQueryPayload,
    pub stages: Vec<RecommendationStagePayload>,
}

pub struct LocalCandidateHydratorExecution {
    pub candidates: Vec<RecommendationCandidatePayload>,
    pub stages: Vec<RecommendationStagePayload>,
}

pub fn run_local_query_hydrators(
    query: &RecommendationQueryPayload,
) -> LocalQueryHydratorExecution {
    let mut current = query.clone();
    let mut stages = Vec::new();

    let (hydrated, stage) = mutual_follow_hydrator(&current);
    current = hydrated;
    stages.push(stage);

    let (hydrated, stage) = demographics_hydrator(&current);
    current = hydrated;
    stages.push(stage);

    let (hydrated, stage) = subscribed_user_ids_hydrator(&current);
    current = hydrated;
    stages.push(stage);

    let (hydrated, stage) = past_request_timestamps_hydrator(&current);
    current = hydrated;
    stages.push(stage);

    let (hydrated, stage) = impressed_posts_hydrator(&current);
    current = hydrated;
    stages.push(stage);

    let (hydrated, stage) = ip_hydrator(&current);
    current = hydrated;
    stages.push(stage);

    LocalQueryHydratorExecution {
        query: current,
        stages,
    }
}

pub fn run_local_candidate_hydrators(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
) -> LocalCandidateHydratorExecution {
    run_selected_local_candidate_hydrators(query, candidates, None)
}

/// 按给定激活列表有序执行纯 Rust 本地候选水合器（`enabled_names == None` 时执行全部 7 个本地水合器）。
pub fn run_selected_local_candidate_hydrators(
    query: &RecommendationQueryPayload,
    candidates: Vec<RecommendationCandidatePayload>,
    enabled_names: Option<&[String]>,
) -> LocalCandidateHydratorExecution {
    let enabled_set =
        enabled_names.map(|names| names.iter().map(String::as_str).collect::<HashSet<&str>>());
    let should_run = |name: &str| {
        enabled_set
            .as_ref()
            .is_none_or(|allowed| allowed.contains(name))
    };

    let mut current = candidates;
    let mut stages = Vec::new();

    if should_run(HAS_MEDIA_CANDIDATE_HYDRATOR) {
        let (hydrated, stage) = has_media_hydrator(query, current);
        current = hydrated;
        stages.push(stage);
    }

    if should_run(VIDEO_DURATION_CANDIDATE_HYDRATOR) {
        let (hydrated, stage) = video_duration_hydrator(query, current);
        current = hydrated;
        stages.push(stage);
    }

    if should_run(ENGAGEMENT_COUNTS_CANDIDATE_HYDRATOR) {
        let (hydrated, stage) = engagement_counts_hydrator(query, current);
        current = hydrated;
        stages.push(stage);
    }

    if should_run(QUOTE_CANDIDATE_HYDRATOR) {
        let (hydrated, stage) = quote_hydrator(query, current);
        current = hydrated;
        stages.push(stage);
    }

    if should_run(MUTUAL_FOLLOW_JACCARD_CANDIDATE_HYDRATOR) {
        let (hydrated, stage) = mutual_follow_jaccard_hydrator(query, current);
        current = hydrated;
        stages.push(stage);
    }

    if should_run(TWEET_TYPE_METRICS_CANDIDATE_HYDRATOR) {
        let (hydrated, stage) = tweet_type_metrics_hydrator(query, current);
        current = hydrated;
        stages.push(stage);
    }

    if should_run(FOLLOWING_REPLIED_USERS_CANDIDATE_HYDRATOR) {
        let (hydrated, stage) = following_replied_users_hydrator(query, current);
        current = hydrated;
        stages.push(stage);
    }

    LocalCandidateHydratorExecution {
        candidates: current,
        stages,
    }
}

fn build_hydrator_stage(
    name: &str,
    input_count: usize,
    output_count: usize,
    detail: Option<HashMap<String, serde_json::Value>>,
) -> RecommendationStagePayload {
    let mut stage_detail = detail.unwrap_or_default();
    annotate_stage_contract_detail(&mut stage_detail, name, PIPELINE_STAGE_KIND_HYDRATOR);
    annotate_rust_owned_stage_detail(&mut stage_detail, "in_process");
    RecommendationStagePayload {
        name: name.to_string(),
        enabled: true,
        duration_ms: 0,
        input_count,
        output_count,
        removed_count: None,
        detail: Some(stage_detail),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_local_query_hydrators_returns_six_stages() {
        let query = RecommendationQueryPayload {
            request_id: "req-hydrator-test".to_string(),
            decision_id: "00000000-0000-4000-8000-0000000000ff".to_string(),
            user_id: "user-1".to_string(),
            limit: 20,
            ..Default::default()
        };

        let result = run_local_query_hydrators(&query);
        assert_eq!(result.stages.len(), 6);
        assert_eq!(result.stages[0].name, "MutualFollowHydrator");
        assert_eq!(result.stages[1].name, "DemographicsHydrator");
        assert_eq!(result.stages[2].name, "SubscribedUserIdsQueryHydrator");
        assert_eq!(result.stages[3].name, "PastRequestTimestampsQueryHydrator");
        assert_eq!(result.stages[4].name, "ImpressedPostsQueryHydrator");
        assert_eq!(result.stages[5].name, "IpQueryHydrator");
    }

    #[test]
    fn run_local_candidate_hydrators_returns_seven_stages() {
        let query = RecommendationQueryPayload {
            request_id: "req-candidate-hydrator-test".to_string(),
            decision_id: "00000000-0000-4000-8000-0000000000ff".to_string(),
            user_id: "user-1".to_string(),
            limit: 20,
            ..Default::default()
        };

        let result = run_local_candidate_hydrators(&query, Vec::new());
        assert_eq!(result.stages.len(), 7);
        assert_eq!(result.stages[0].name, "HasMediaCandidateHydrator");
        assert_eq!(result.stages[1].name, "VideoDurationCandidateHydrator");
        assert_eq!(result.stages[2].name, "EngagementCountsCandidateHydrator");
        assert_eq!(result.stages[3].name, "QuoteCandidateHydrator");
        assert_eq!(
            result.stages[4].name,
            "MutualFollowJaccardCandidateHydrator"
        );
        assert_eq!(result.stages[5].name, "TweetTypeMetricsCandidateHydrator");
        assert_eq!(
            result.stages[6].name,
            "FollowingRepliedUsersCandidateHydrator"
        );
    }
}
