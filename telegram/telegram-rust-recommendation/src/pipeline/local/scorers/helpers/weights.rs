pub(in crate::pipeline::local::scorers) const WEIGHTED_SCORER_POLICY_VERSION: &str =
    "weighted_scorer_policy_v1";

pub(in crate::pipeline::local::scorers) const LIKE_WEIGHT: f64 = 2.0;
pub(in crate::pipeline::local::scorers) const REPLY_WEIGHT: f64 = 5.0;
pub(in crate::pipeline::local::scorers) const REPOST_WEIGHT: f64 = 4.0;
pub(in crate::pipeline::local::scorers) const QUOTE_WEIGHT: f64 = 4.5;
pub(in crate::pipeline::local::scorers) const PHOTO_EXPAND_WEIGHT: f64 = 1.0;
pub(in crate::pipeline::local::scorers) const CLICK_WEIGHT: f64 = 0.5;
pub(in crate::pipeline::local::scorers) const QUOTED_CLICK_WEIGHT: f64 = 0.8;
pub(in crate::pipeline::local::scorers) const PROFILE_CLICK_WEIGHT: f64 = 1.0;
pub(in crate::pipeline::local::scorers) const VIDEO_QUALITY_VIEW_WEIGHT: f64 = 3.0;
pub(in crate::pipeline::local::scorers) const SHARE_WEIGHT: f64 = 2.5;
pub(in crate::pipeline::local::scorers) const SHARE_VIA_DM_WEIGHT: f64 = 2.0;
pub(in crate::pipeline::local::scorers) const SHARE_VIA_COPY_LINK_WEIGHT: f64 = 1.5;
pub(in crate::pipeline::local::scorers) const DWELL_WEIGHT: f64 = 0.3;
pub(in crate::pipeline::local::scorers) const DWELL_TIME_WEIGHT: f64 = 0.05;
pub(in crate::pipeline::local::scorers) const FOLLOW_AUTHOR_WEIGHT: f64 = 2.4;

pub(in crate::pipeline::local::scorers) const NOT_INTERESTED_WEIGHT: f64 = 5.0;
pub(in crate::pipeline::local::scorers) const DISMISS_WEIGHT: f64 = 5.0;
pub(in crate::pipeline::local::scorers) const BLOCK_AUTHOR_WEIGHT: f64 = 10.0;
pub(in crate::pipeline::local::scorers) const BLOCK_WEIGHT: f64 = 10.0;
pub(in crate::pipeline::local::scorers) const MUTE_AUTHOR_WEIGHT: f64 = 4.0;
pub(in crate::pipeline::local::scorers) const REPORT_WEIGHT: f64 = 8.0;

pub(in crate::pipeline::local::scorers) const ACTION_SCORE_NEGATIVE_WEIGHT: f64 = 12.0;

pub(in crate::pipeline::local::scorers) const HEURISTIC_ENGAGEMENT_RATE_WEIGHT: f64 = 3.1;
pub(in crate::pipeline::local::scorers) const HEURISTIC_REPLY_WEIGHT: f64 = 3.8;
pub(in crate::pipeline::local::scorers) const HEURISTIC_REPOST_WEIGHT: f64 = 3.3;
pub(in crate::pipeline::local::scorers) const HEURISTIC_CLICK_WEIGHT: f64 = 1.2;
pub(in crate::pipeline::local::scorers) const HEURISTIC_CONTENT_WEIGHT: f64 = 0.9;
pub(in crate::pipeline::local::scorers) const HEURISTIC_FOLLOW_WEIGHT: f64 = 2.2;
pub(in crate::pipeline::local::scorers) const HEURISTIC_RETRIEVAL_SUPPORT_WEIGHT: f64 = 1.7;

pub(in crate::pipeline::local::scorers) const WEIGHTED_EVIDENCE_PRIOR_WEIGHT: f64 = 0.12;
pub(in crate::pipeline::local::scorers) const WEIGHTED_SIGNAL_PRIOR_WEIGHT: f64 = 0.1;
