pub const WEIGHTED_SCORER_POLICY_VERSION: &str = "weighted_scorer_policy_v1";

pub const POSITIVE_WEIGHT_SUM: f64 = 30.15;
pub const NEGATIVE_WEIGHT_SUM: f64 = 27.0;
pub const NEGATIVE_SCORES_OFFSET: f64 = 0.1;

const LIKE_WEIGHT: f64 = 2.0;
const REPLY_WEIGHT: f64 = 5.0;
const REPOST_WEIGHT: f64 = 4.0;
const QUOTE_WEIGHT: f64 = 4.5;
const PHOTO_EXPAND_WEIGHT: f64 = 1.0;
const CLICK_WEIGHT: f64 = 0.5;
const QUOTED_CLICK_WEIGHT: f64 = 0.8;
const PROFILE_CLICK_WEIGHT: f64 = 1.0;
const VIDEO_QUALITY_VIEW_WEIGHT: f64 = 3.0;
const SHARE_WEIGHT: f64 = 2.5;
const SHARE_VIA_DM_WEIGHT: f64 = 2.0;
const SHARE_VIA_COPY_LINK_WEIGHT: f64 = 1.5;
const DWELL_WEIGHT: f64 = 0.3;
const DWELL_TIME_WEIGHT: f64 = 0.05;
const FOLLOW_AUTHOR_WEIGHT: f64 = 2.4;

const NOT_INTERESTED_WEIGHT: f64 = 5.0;
const DISMISS_WEIGHT: f64 = 5.0;
const BLOCK_AUTHOR_WEIGHT: f64 = 10.0;
const BLOCK_WEIGHT: f64 = 10.0;
const MUTE_AUTHOR_WEIGHT: f64 = 4.0;
const REPORT_WEIGHT: f64 = 8.0;

const ACTION_SCORE_NEGATIVE_WEIGHT: f64 = 12.0;

pub const WEIGHTED_EVIDENCE_PRIOR_WEIGHT: f64 = 0.12;
pub const WEIGHTED_SIGNAL_PRIOR_WEIGHT: f64 = 0.1;

#[derive(Debug, Clone, Copy, Default)]
pub struct PhoenixWeightedScoreInput {
    pub like: f64,
    pub reply: f64,
    pub repost: f64,
    pub quote: f64,
    pub photo_expand: f64,
    pub click: f64,
    pub quoted_click: f64,
    pub profile_click: f64,
    pub video_quality_view: f64,
    pub share: f64,
    pub share_via_dm: f64,
    pub share_via_copy_link: f64,
    pub dwell: f64,
    pub dwell_time: f64,
    pub follow_author: f64,
    pub not_interested: f64,
    pub dismiss: f64,
    pub block_author: f64,
    pub block: f64,
    pub mute_author: f64,
    pub report: f64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ActionWeightedScoreInput {
    pub like: f64,
    pub reply: f64,
    pub repost: f64,
    pub click: f64,
    pub dwell: f64,
    pub negative: f64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct HeuristicWeightedScoreInput {
    pub engagement_rate: f64,
    pub reply_proxy: f64,
    pub repost_proxy: f64,
    pub click_proxy: f64,
    pub content_proxy: f64,
    pub follow_proxy: f64,
    pub retrieval_support: f64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct WeightedScoreInput {
    pub phoenix_scores: Option<PhoenixWeightedScoreInput>,
    pub action_scores: Option<ActionWeightedScoreInput>,
    pub heuristic_scores: HeuristicWeightedScoreInput,
    pub evidence_prior: f64,
    pub signal_prior: f64,
}

#[derive(Debug, Clone, Copy, Default)]
pub struct WeightedScoreSummary {
    pub raw_score: f64,
    pub base_raw_score: f64,
    pub positive_score: f64,
    pub negative_score: f64,
    pub evidence_prior: f64,
    pub signal_prior: f64,
    pub evidence_score: f64,
    pub action_scores_used: bool,
    pub heuristic_fallback_used: bool,
}

pub fn compute_weighted_score_summary(input: WeightedScoreInput) -> WeightedScoreSummary {
    let (positive_score, negative_score, action_scores_used, heuristic_fallback_used) =
        if let Some(scores) = input.phoenix_scores {
            (
                scores.like * LIKE_WEIGHT
                    + scores.reply * REPLY_WEIGHT
                    + scores.repost * REPOST_WEIGHT
                    + scores.quote * QUOTE_WEIGHT
                    + scores.photo_expand * PHOTO_EXPAND_WEIGHT
                    + scores.click * CLICK_WEIGHT
                    + scores.quoted_click * QUOTED_CLICK_WEIGHT
                    + scores.profile_click * PROFILE_CLICK_WEIGHT
                    + scores.video_quality_view * VIDEO_QUALITY_VIEW_WEIGHT
                    + scores.share * SHARE_WEIGHT
                    + scores.share_via_dm * SHARE_VIA_DM_WEIGHT
                    + scores.share_via_copy_link * SHARE_VIA_COPY_LINK_WEIGHT
                    + scores.dwell * DWELL_WEIGHT
                    + scores.dwell_time * DWELL_TIME_WEIGHT
                    + scores.follow_author * FOLLOW_AUTHOR_WEIGHT,
                scores.not_interested * NOT_INTERESTED_WEIGHT
                    + scores.dismiss * DISMISS_WEIGHT
                    + scores.block_author * BLOCK_AUTHOR_WEIGHT
                    + scores.block * BLOCK_WEIGHT
                    + scores.mute_author * MUTE_AUTHOR_WEIGHT
                    + scores.report * REPORT_WEIGHT,
                false,
                false,
            )
        } else if let Some(scores) = input.action_scores {
            (
                scores.like * LIKE_WEIGHT
                    + scores.reply * REPLY_WEIGHT
                    + scores.repost * REPOST_WEIGHT
                    + scores.click * CLICK_WEIGHT
                    + scores.dwell * DWELL_WEIGHT,
                scores.negative * ACTION_SCORE_NEGATIVE_WEIGHT,
                true,
                false,
            )
        } else {
            (
                input.heuristic_scores.engagement_rate * 3.1
                    + input.heuristic_scores.reply_proxy * 3.8
                    + input.heuristic_scores.repost_proxy * 3.3
                    + input.heuristic_scores.click_proxy * 1.2
                    + input.heuristic_scores.content_proxy * 0.9
                    + input.heuristic_scores.follow_proxy * 2.2
                    + input.heuristic_scores.retrieval_support * 1.7,
                0.0,
                false,
                true,
            )
        };

    let base_raw_score = positive_score - negative_score;
    let evidence_score = if base_raw_score > 0.0 {
        input.evidence_prior * WEIGHTED_EVIDENCE_PRIOR_WEIGHT
            + input.signal_prior * WEIGHTED_SIGNAL_PRIOR_WEIGHT
    } else {
        0.0
    };

    WeightedScoreSummary {
        raw_score: base_raw_score + evidence_score,
        base_raw_score,
        positive_score,
        negative_score,
        evidence_prior: input.evidence_prior,
        signal_prior: input.signal_prior,
        evidence_score,
        action_scores_used,
        heuristic_fallback_used,
    }
}

pub fn normalize_weighted_score(raw_score: f64) -> f64 {
    if raw_score < 0.0 {
        (((raw_score + NEGATIVE_WEIGHT_SUM) / POSITIVE_WEIGHT_SUM) * NEGATIVE_SCORES_OFFSET)
            .max(0.0)
    } else {
        raw_score / POSITIVE_WEIGHT_SUM + NEGATIVE_SCORES_OFFSET
    }
}

#[cfg(test)]
mod tests {
    use super::{
        ActionWeightedScoreInput, HeuristicWeightedScoreInput, NEGATIVE_SCORES_OFFSET,
        NEGATIVE_WEIGHT_SUM, POSITIVE_WEIGHT_SUM, PhoenixWeightedScoreInput, WeightedScoreInput,
        compute_weighted_score_summary, normalize_weighted_score,
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
        assert_eq!(POSITIVE_WEIGHT_SUM, 30.15);
        assert_eq!(NEGATIVE_WEIGHT_SUM, 27.0);
        assert_eq!(NEGATIVE_SCORES_OFFSET, 0.1);
        assert!(normalize_weighted_score(1.0) > NEGATIVE_SCORES_OFFSET);
        assert!(normalize_weighted_score(-1.0) < NEGATIVE_SCORES_OFFSET);
    }
}
