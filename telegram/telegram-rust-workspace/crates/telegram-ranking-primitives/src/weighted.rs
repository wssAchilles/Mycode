pub const WEIGHTED_SCORER_POLICY_VERSION: &str = "weighted_scorer_policy_v1";

pub const POSITIVE_WEIGHT_SUM: f64 = 30.55;
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

trait FiniteOrDefault {
    fn finite_or_default(self) -> Self;
}

impl FiniteOrDefault for f64 {
    fn finite_or_default(self) -> Self {
        if self.is_finite() { self } else { 0.0 }
    }
}

impl FiniteOrDefault for PhoenixWeightedScoreInput {
    fn finite_or_default(self) -> Self {
        Self {
            like: self.like.finite_or_default(),
            reply: self.reply.finite_or_default(),
            repost: self.repost.finite_or_default(),
            quote: self.quote.finite_or_default(),
            photo_expand: self.photo_expand.finite_or_default(),
            click: self.click.finite_or_default(),
            quoted_click: self.quoted_click.finite_or_default(),
            profile_click: self.profile_click.finite_or_default(),
            video_quality_view: self.video_quality_view.finite_or_default(),
            share: self.share.finite_or_default(),
            share_via_dm: self.share_via_dm.finite_or_default(),
            share_via_copy_link: self.share_via_copy_link.finite_or_default(),
            dwell: self.dwell.finite_or_default(),
            dwell_time: self.dwell_time.finite_or_default(),
            follow_author: self.follow_author.finite_or_default(),
            not_interested: self.not_interested.finite_or_default(),
            dismiss: self.dismiss.finite_or_default(),
            block_author: self.block_author.finite_or_default(),
            block: self.block.finite_or_default(),
            mute_author: self.mute_author.finite_or_default(),
            report: self.report.finite_or_default(),
        }
    }
}

impl FiniteOrDefault for ActionWeightedScoreInput {
    fn finite_or_default(self) -> Self {
        Self {
            like: self.like.finite_or_default(),
            reply: self.reply.finite_or_default(),
            repost: self.repost.finite_or_default(),
            click: self.click.finite_or_default(),
            dwell: self.dwell.finite_or_default(),
            negative: self.negative.finite_or_default(),
        }
    }
}

impl FiniteOrDefault for HeuristicWeightedScoreInput {
    fn finite_or_default(self) -> Self {
        Self {
            engagement_rate: self.engagement_rate.finite_or_default(),
            reply_proxy: self.reply_proxy.finite_or_default(),
            repost_proxy: self.repost_proxy.finite_or_default(),
            click_proxy: self.click_proxy.finite_or_default(),
            content_proxy: self.content_proxy.finite_or_default(),
            follow_proxy: self.follow_proxy.finite_or_default(),
            retrieval_support: self.retrieval_support.finite_or_default(),
        }
    }
}

fn finite_or_zero(value: f64) -> f64 {
    value.finite_or_default()
}

pub fn compute_weighted_score_summary(input: WeightedScoreInput) -> WeightedScoreSummary {
    let input = WeightedScoreInput {
        phoenix_scores: input.phoenix_scores.map(FiniteOrDefault::finite_or_default),
        action_scores: input.action_scores.map(FiniteOrDefault::finite_or_default),
        heuristic_scores: input.heuristic_scores.finite_or_default(),
        evidence_prior: finite_or_zero(input.evidence_prior),
        signal_prior: finite_or_zero(input.signal_prior),
    };
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

    let positive_score = finite_or_zero(positive_score);
    let negative_score = finite_or_zero(negative_score);
    let base_raw_score = finite_or_zero(positive_score - negative_score);
    let evidence_score = if base_raw_score > 0.0 {
        finite_or_zero(
            input.evidence_prior * WEIGHTED_EVIDENCE_PRIOR_WEIGHT
                + input.signal_prior * WEIGHTED_SIGNAL_PRIOR_WEIGHT,
        )
    } else {
        0.0
    };

    WeightedScoreSummary {
        raw_score: finite_or_zero(base_raw_score + evidence_score),
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
    let raw_score = finite_or_zero(raw_score);
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
}
