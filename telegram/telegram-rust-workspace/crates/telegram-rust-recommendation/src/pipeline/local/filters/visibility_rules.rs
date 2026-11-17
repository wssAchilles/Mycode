//! 声明式可见性规则引擎（对标 `x-algorithm/visibility-filtering/rules/`）。
//! 定义 `SafetyLevel`、`ActionKind` 严密优先级（`Drop > Tombstone > Interstitial > Downrank > Allow`）
//! 与三值逻辑 `Truth::{True, False, Unknown}`，综合评估异步安全标签 `content_safety_labels`、
//! 传统 `vf_result`（支持 `safe | low_risk | medium | high | blocked`）以及作者声誉分 `author_cred_score`。

use std::ops::Not;

use crate::contracts::{
    ContentSafetyLabelsPayload, RecommendationCandidatePayload, RecommendationQueryPayload,
};

/// 高信誉作者免误伤阈值（当 `author_cred_score >= 0.80` 时，对轻度 `low_risk` 文本标签放行）。
pub const HIGH_CREDIBILITY_EXEMPT_THRESHOLD: f64 = 0.80;

/// 场景安全等级（对标 `x-algorithm/visibility-filtering/rules/safety_level.rs`）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SafetyLevel {
    /// 最严格全域过滤：不接受未知安全状态的候选。
    FilterAll,
    /// 关注时间线场景。
    TimelineHome,
    /// 推荐信息流场景（允许对网内关注与冷启动新闻做受控未知态处理）。
    TimelineHomeRecommendations,
    /// 候选水合期安全校验场景。
    TimelineHomeHydration,
    /// 引用帖独立规则通道。
    QuotedTweetRules,
}

impl SafetyLevel {
    /// 从查询上下文及实验配置推导当前 `SafetyLevel`。
    pub fn from_query(query: &RecommendationQueryPayload, configured_level: Option<&str>) -> Self {
        if let Some(raw) = configured_level {
            match raw.trim().to_ascii_lowercase().as_str() {
                "filter_all" | "filterall" => return Self::FilterAll,
                "timeline_home" | "timelinehome" => return Self::TimelineHome,
                "timeline_home_recommendations" | "timelinehomerecommendations" => {
                    return Self::TimelineHomeRecommendations;
                }
                "timeline_home_hydration" | "timelinehomehydration" => {
                    return Self::TimelineHomeHydration;
                }
                "quoted_tweet_rules" | "quotedtweetrules" => return Self::QuotedTweetRules,
                _ => {}
            }
        }
        if query.in_network_only {
            Self::TimelineHome
        } else {
            Self::TimelineHomeRecommendations
        }
    }

    /// 返回小写蛇形标识名，用于可观测上报。
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::FilterAll => "filter_all",
            Self::TimelineHome => "timeline_home",
            Self::TimelineHomeRecommendations => "timeline_home_recommendations",
            Self::TimelineHomeHydration => "timeline_home_hydration",
            Self::QuotedTweetRules => "quoted_tweet_rules",
        }
    }

    /// 在当前安全等级下，当安全结果完全缺失时是否允许网内/冷启新闻默认放行。
    pub const fn allows_controlled_unknown_fallback(self) -> bool {
        !matches!(self, Self::FilterAll)
    }
}

/// 可见性动作类型，按严密优先级排序：`Drop > Tombstone > Interstitial > Downrank > Allow`。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ActionKind {
    Allow = 0,
    Downrank = 1,
    Interstitial = 2,
    Tombstone = 3,
    Drop = 4,
}

impl ActionKind {
    /// 返回动作严重度数值（越大越优先）。
    pub const fn severity(self) -> u8 {
        self as u8
    }

    /// 判断动作是否属于终结性拦截（`Drop` 或 `Tombstone`）。
    pub const fn is_withheld(self) -> bool {
        matches!(self, Self::Drop | Self::Tombstone)
    }

    /// 返回动作的小写字符串标识。
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Allow => "allow",
            Self::Downrank => "downrank",
            Self::Interstitial => "interstitial",
            Self::Tombstone => "tombstone",
            Self::Drop => "drop",
        }
    }
}

/// 三值逻辑判定结果（对标 `x-algorithm/visibility-filtering/rules/rule_spec.rs::Truth`）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Truth {
    True,
    False,
    Unknown { default: bool },
}

impl Truth {
    /// 将三值逻辑折叠为最终布尔判定结果。
    #[inline]
    pub const fn resolves_true(self) -> bool {
        matches!(self, Self::True | Self::Unknown { default: true })
    }

    /// 是否处于信息缺失的未知态。
    #[inline]
    pub const fn is_unknown(self) -> bool {
        matches!(self, Self::Unknown { .. })
    }

    /// 三值逻辑合取（AND）。
    #[inline]
    pub const fn and(self, other: Self) -> Self {
        match (self, other) {
            (Self::False, _) | (_, Self::False) => Self::False,
            (Self::True, rhs) | (rhs, Self::True) => rhs,
            (Self::Unknown { default: a }, Self::Unknown { default: b }) => {
                Self::Unknown { default: a && b }
            }
        }
    }

    /// 三值逻辑析取（OR）。
    #[inline]
    pub const fn or(self, other: Self) -> Self {
        match (self, other) {
            (Self::True, _) | (_, Self::True) => Self::True,
            (Self::False, rhs) | (rhs, Self::False) => rhs,
            (Self::Unknown { default: a }, Self::Unknown { default: b }) => {
                Self::Unknown { default: a || b }
            }
        }
    }
}

impl Not for Truth {
    type Output = Self;

    #[inline]
    fn not(self) -> Self::Output {
        match self {
            Self::True => Self::False,
            Self::False => Self::True,
            Self::Unknown { default } => Self::Unknown { default: !default },
        }
    }
}

/// 归一化后的内容风险级别。
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum NormalizedRiskLevel {
    Safe = 0,
    LowRisk = 1,
    Medium = 2,
    High = 3,
    Blocked = 4,
    Unknown = 5,
}

impl NormalizedRiskLevel {
    /// 解析字符串形式的安全级别（不区分大小写）。
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "safe" | "standard" | "high_quality" | "clean" => Some(Self::Safe),
            "low_risk" | "lowrisk" | "low_quality" => Some(Self::LowRisk),
            "medium" | "borderline" => Some(Self::Medium),
            "high" | "high_risk" => Some(Self::High),
            "blocked" | "drop" | "ban" | "banned" => Some(Self::Blocked),
            _ => None,
        }
    }

    /// 返回规范化等级名。
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Safe => "safe",
            Self::LowRisk => "low_risk",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Blocked => "blocked",
            Self::Unknown => "unknown",
        }
    }
}

/// 规则求值上下文配置。
#[derive(Clone, Copy, Debug)]
pub struct VisibilityPolicyConfig {
    pub safety_level: SafetyLevel,
    pub is_cold_start: bool,
    pub allow_news_cold_start: bool,
    pub allow_in_network_low_risk: bool,
    pub allow_oon_low_risk: bool,
    pub drop_interstitial: bool,
    pub high_cred_threshold: f64,
}

impl Default for VisibilityPolicyConfig {
    fn default() -> Self {
        Self {
            safety_level: SafetyLevel::TimelineHomeRecommendations,
            is_cold_start: false,
            allow_news_cold_start: true,
            allow_in_network_low_risk: true,
            allow_oon_low_risk: false,
            drop_interstitial: false,
            high_cred_threshold: HIGH_CREDIBILITY_EXEMPT_THRESHOLD,
        }
    }
}

/// 单条声明式可见性规则描述。
#[derive(Clone, Copy, Debug)]
pub struct VisibilityRuleSpec {
    pub id: &'static str,
    pub action: ActionKind,
    pub reason: &'static str,
    pub evaluator: fn(&RecommendationCandidatePayload, &VisibilityPolicyConfig) -> Truth,
}

/// 规则折叠后的最终可见性裁决结果。
#[derive(Clone, Debug, PartialEq)]
pub struct VisibilityVerdict {
    pub action: ActionKind,
    pub truth: Truth,
    pub matched_rule: &'static str,
    pub reason: &'static str,
    pub effective_level: NormalizedRiskLevel,
    pub credibility_exempt: bool,
    pub fail_open_used: bool,
    pub used_content_safety_labels: bool,
    pub downrank_multiplier: f64,
}

impl VisibilityVerdict {
    /// 该候选是否应在过滤阶段被直接剔除。
    pub const fn should_drop(&self) -> bool {
        self.action.is_withheld()
    }
}

/// 不可豁免的严厉安全关键字（对 `nsfw`/`high`/`blocked` 等红线标签绝不放行）。
const STRICT_NON_EXEMPT_TAGS: &[&str] = &[
    "nsfw",
    "adult",
    "porn",
    "gore",
    "violence",
    "violent",
    "high",
    "blocked",
    "illegal",
    "csam",
    "self_harm",
    "suicide",
    "hate",
    "harassment",
    "scam",
    "malware",
    "phishing",
    "pdna",
    "bounced",
    "legal_takedown",
    "tombstone",
    "suspended",
    "explicit_media",
];

/// 检查标签集合是否命中不可豁免红线标签。
fn contains_strict_tag<'a>(tags: impl IntoIterator<Item = &'a str>) -> bool {
    for tag in tags {
        let lower = tag.trim().to_ascii_lowercase();
        if lower.is_empty() {
            continue;
        }
        if STRICT_NON_EXEMPT_TAGS
            .iter()
            .any(|needle| lower == *needle || lower.contains(needle))
        {
            return true;
        }
    }
    false
}

/// 检查标签集合是否包含墓碑类下架标签。
fn contains_tombstone_tag<'a>(tags: impl IntoIterator<Item = &'a str>) -> bool {
    for tag in tags {
        let lower = tag.trim().to_ascii_lowercase();
        if matches!(
            lower.as_str(),
            "tombstone" | "removed" | "deleted" | "withheld" | "local_regulations" | "bounced"
        ) || lower.contains("tombstone")
        {
            return true;
        }
    }
    false
}

/// 检查候选是否存在不可豁免的严厉违规信号（`nsfw / high / blocked`）。
pub fn has_strict_non_exempt_risk(candidate: &RecommendationCandidatePayload) -> bool {
    if candidate.is_nsfw == Some(true) {
        return true;
    }

    if let Some(vf) = candidate.vf_result.as_ref() {
        if let Some(level) = vf.level.as_deref().and_then(NormalizedRiskLevel::parse)
            && matches!(
                level,
                NormalizedRiskLevel::High | NormalizedRiskLevel::Blocked
            )
        {
            return true;
        }
        if let Some(reason) = vf.reason.as_deref()
            && contains_strict_tag(std::iter::once(reason))
        {
            return true;
        }
        if let Some(violations) = vf.violations.as_ref()
            && contains_strict_tag(violations.iter().map(String::as_str))
        {
            return true;
        }
    }

    if let Some(labels) = candidate.content_safety_labels.as_ref() {
        if let Some(level) = labels.level.as_deref().and_then(NormalizedRiskLevel::parse)
            && matches!(
                level,
                NormalizedRiskLevel::High | NormalizedRiskLevel::Blocked
            )
        {
            return true;
        }
        if contains_strict_tag(labels.labels.iter().map(String::as_str)) {
            return true;
        }
    }

    false
}

/// 提取候选综合后的最高风险等级。
pub fn resolve_effective_risk_level(
    candidate: &RecommendationCandidatePayload,
) -> NormalizedRiskLevel {
    let vf_level = candidate
        .vf_result
        .as_ref()
        .and_then(|vf| vf.level.as_deref())
        .and_then(NormalizedRiskLevel::parse);
    let label_level = candidate
        .content_safety_labels
        .as_ref()
        .and_then(|labels| labels.level.as_deref())
        .and_then(NormalizedRiskLevel::parse);

    match (vf_level, label_level) {
        (Some(a), Some(b)) => a.max(b),
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => {
            if candidate.is_nsfw == Some(true) {
                NormalizedRiskLevel::High
            } else if candidate.vf_result.as_ref().is_some_and(|v| v.safe)
                || candidate
                    .content_safety_labels
                    .as_ref()
                    .is_some_and(|l| l.safe)
            {
                NormalizedRiskLevel::Safe
            } else if candidate.vf_result.as_ref().is_some_and(|v| !v.safe)
                || candidate
                    .content_safety_labels
                    .as_ref()
                    .is_some_and(|l| !l.safe)
            {
                NormalizedRiskLevel::High
            } else {
                NormalizedRiskLevel::Unknown
            }
        }
    }
}

/// 判断候选是否满足高信誉作者免误伤条件：
/// 作者可信度 `>= 0.80`，无任何 `nsfw/high/blocked` 严厉红线，且处于轻度 `low_risk` 范畴。
pub fn is_high_credibility_low_risk_exempt(
    candidate: &RecommendationCandidatePayload,
    threshold: f64,
) -> bool {
    let cred_ok = candidate
        .author_cred_score
        .is_some_and(|score| score.is_finite() && score >= threshold);
    if !cred_ok || has_strict_non_exempt_risk(candidate) {
        return false;
    }

    let level = resolve_effective_risk_level(candidate);
    if level == NormalizedRiskLevel::LowRisk {
        return true;
    }

    // 若未填 `level`，但异步标签仅为轻度文本风险提示且非 medium/high/blocked，也视作轻度可豁免
    if level == NormalizedRiskLevel::Unknown
        || (level == NormalizedRiskLevel::Safe
            && candidate
                .content_safety_labels
                .as_ref()
                .is_some_and(|l| !l.safe))
    {
        return has_mild_text_label_only(candidate.content_safety_labels.as_ref());
    }

    false
}

fn has_mild_text_label_only(labels: Option<&ContentSafetyLabelsPayload>) -> bool {
    let Some(labels) = labels else {
        return false;
    };
    !labels.labels.is_empty()
        && !contains_strict_tag(labels.labels.iter().map(String::as_str))
        && labels.labels.iter().any(|tag| {
            let lower = tag.trim().to_ascii_lowercase();
            lower.contains("low_risk")
                || lower.contains("mild")
                || lower.contains("text")
                || lower.contains("clickbait")
                || lower.contains("sensitive_text")
        })
}

fn rule_strict_nsfw_or_high_or_blocked(
    candidate: &RecommendationCandidatePayload,
    _cfg: &VisibilityPolicyConfig,
) -> Truth {
    if has_strict_non_exempt_risk(candidate) {
        Truth::True
    } else {
        Truth::False
    }
}

fn rule_missing_safety_metadata_fail_closed(
    candidate: &RecommendationCandidatePayload,
    cfg: &VisibilityPolicyConfig,
) -> Truth {
    if candidate.vf_result.is_some() || candidate.content_safety_labels.is_some() {
        return Truth::False;
    }

    if !cfg.safety_level.allows_controlled_unknown_fallback() {
        return Truth::Unknown { default: true };
    }

    let controlled_allow = candidate.in_network == Some(true)
        || (cfg.is_cold_start && cfg.allow_news_cold_start && candidate.is_news == Some(true));
    if controlled_allow {
        // 网内或冷启动新闻受控降级放行：按规则未触发拦截
        Truth::Unknown { default: false }
    } else {
        // 域外未知内容严格 fail-closed 拦截
        Truth::Unknown { default: true }
    }
}

fn rule_tombstone_withheld(
    candidate: &RecommendationCandidatePayload,
    cfg: &VisibilityPolicyConfig,
) -> Truth {
    let mut tags: Vec<&str> = Vec::new();
    if let Some(vf) = candidate.vf_result.as_ref() {
        if let Some(reason) = vf.reason.as_deref() {
            tags.push(reason);
        }
        if let Some(violations) = vf.violations.as_deref() {
            tags.extend(violations.iter().map(String::as_str));
        }
    }
    if let Some(labels) = candidate.content_safety_labels.as_ref() {
        tags.extend(labels.labels.iter().map(String::as_str));
    }
    if contains_tombstone_tag(tags) {
        return Truth::True;
    }

    // 中风险且明确被安全系统判定 `safe == false` 时，按 Tombstone 下架拦截
    let level = resolve_effective_risk_level(candidate);
    let marked_unsafe = candidate.vf_result.as_ref().is_some_and(|v| !v.safe)
        || candidate
            .content_safety_labels
            .as_ref()
            .is_some_and(|l| !l.safe);
    if level == NormalizedRiskLevel::Medium
        && (marked_unsafe || cfg.safety_level == SafetyLevel::FilterAll)
    {
        return Truth::True;
    }

    Truth::False
}

fn rule_explicit_unsafe_without_cred_exemption(
    candidate: &RecommendationCandidatePayload,
    cfg: &VisibilityPolicyConfig,
) -> Truth {
    if is_high_credibility_low_risk_exempt(candidate, cfg.high_cred_threshold) {
        return Truth::False;
    }

    let vf_unsafe = candidate.vf_result.as_ref().is_some_and(|vf| !vf.safe);
    let label_unsafe = candidate
        .content_safety_labels
        .as_ref()
        .is_some_and(|labels| !labels.safe);

    if vf_unsafe || label_unsafe {
        Truth::True
    } else {
        Truth::False
    }
}

fn rule_low_risk_policy_gate(
    candidate: &RecommendationCandidatePayload,
    cfg: &VisibilityPolicyConfig,
) -> Truth {
    if is_high_credibility_low_risk_exempt(candidate, cfg.high_cred_threshold) {
        return Truth::False;
    }

    let level = resolve_effective_risk_level(candidate);
    if level != NormalizedRiskLevel::LowRisk {
        return Truth::False;
    }

    let allowed = if candidate.in_network == Some(true) {
        cfg.allow_in_network_low_risk
    } else {
        cfg.allow_oon_low_risk
    };

    if allowed { Truth::False } else { Truth::True }
}

fn rule_medium_interstitial(
    candidate: &RecommendationCandidatePayload,
    cfg: &VisibilityPolicyConfig,
) -> Truth {
    let level = resolve_effective_risk_level(candidate);
    if level == NormalizedRiskLevel::Medium {
        let _ = cfg;
        Truth::True
    } else {
        Truth::False
    }
}

fn rule_low_risk_or_borderline_downrank(
    candidate: &RecommendationCandidatePayload,
    cfg: &VisibilityPolicyConfig,
) -> Truth {
    if is_high_credibility_low_risk_exempt(candidate, cfg.high_cred_threshold) {
        return Truth::False;
    }

    let level = resolve_effective_risk_level(candidate);
    if matches!(
        level,
        NormalizedRiskLevel::LowRisk | NormalizedRiskLevel::Medium
    ) {
        return Truth::True;
    }

    let low_safety_score = candidate
        .vf_result
        .as_ref()
        .and_then(|v| v.score)
        .is_some_and(|s| s.is_finite() && s < 0.65)
        || candidate
            .content_safety_labels
            .as_ref()
            .and_then(|l| l.score)
            .is_some_and(|s| s.is_finite() && s < 0.65);

    if low_safety_score {
        Truth::True
    } else {
        Truth::False
    }
}

/// 声明式可见性规则目录（折叠引擎会在求值前严格按 `ActionKind::severity()` 降序排序）。
const VISIBILITY_RULES: &[VisibilityRuleSpec] = &[
    VisibilityRuleSpec {
        id: "strict_nsfw_high_blocked_drop",
        action: ActionKind::Drop,
        reason: "strict_safety_violation",
        evaluator: rule_strict_nsfw_or_high_or_blocked,
    },
    VisibilityRuleSpec {
        id: "missing_safety_metadata_fail_closed_drop",
        action: ActionKind::Drop,
        reason: "missing_visibility_fail_closed",
        evaluator: rule_missing_safety_metadata_fail_closed,
    },
    VisibilityRuleSpec {
        id: "tombstone_or_unsafe_medium_withheld",
        action: ActionKind::Tombstone,
        reason: "tombstone_withheld",
        evaluator: rule_tombstone_withheld,
    },
    VisibilityRuleSpec {
        id: "explicit_unsafe_drop",
        action: ActionKind::Drop,
        reason: "visibility_unsafe",
        evaluator: rule_explicit_unsafe_without_cred_exemption,
    },
    VisibilityRuleSpec {
        id: "low_risk_gate_drop",
        action: ActionKind::Drop,
        reason: "low_risk_policy_rejected",
        evaluator: rule_low_risk_policy_gate,
    },
    VisibilityRuleSpec {
        id: "medium_risk_interstitial",
        action: ActionKind::Interstitial,
        reason: "medium_risk_interstitial",
        evaluator: rule_medium_interstitial,
    },
    VisibilityRuleSpec {
        id: "low_risk_or_borderline_downrank",
        action: ActionKind::Downrank,
        reason: "low_risk_downrank",
        evaluator: rule_low_risk_or_borderline_downrank,
    },
];

/// 按严密优先级（`Drop > Tombstone > Interstitial > Downrank > Allow`）折叠声明式规则列表。
pub fn evaluate_rules_with_precedence(
    rules: &[VisibilityRuleSpec],
    candidate: &RecommendationCandidatePayload,
    cfg: &VisibilityPolicyConfig,
) -> VisibilityVerdict {
    let mut sorted_indices: Vec<usize> = (0..rules.len()).collect();
    sorted_indices.sort_by(|&a, &b| rules[b].action.severity().cmp(&rules[a].action.severity()));

    let effective_level = resolve_effective_risk_level(candidate);
    let credibility_exempt =
        is_high_credibility_low_risk_exempt(candidate, cfg.high_cred_threshold);
    let used_content_safety_labels = candidate.content_safety_labels.is_some();
    let fail_open_used = candidate.vf_result.is_none()
        && candidate.content_safety_labels.is_none()
        && cfg.safety_level.allows_controlled_unknown_fallback()
        && (candidate.in_network == Some(true)
            || (cfg.is_cold_start && cfg.allow_news_cold_start && candidate.is_news == Some(true)));

    let mut chosen_action = ActionKind::Allow;
    let mut chosen_truth =
        if candidate.vf_result.is_none() && candidate.content_safety_labels.is_none() {
            Truth::Unknown {
                default: !fail_open_used,
            }
        } else {
            Truth::True
        };
    let mut chosen_rule = if credibility_exempt {
        "high_credibility_low_risk_exempt"
    } else {
        "allow_default"
    };
    let mut chosen_reason = if credibility_exempt {
        "high_credibility_exempt"
    } else {
        "safe_allow"
    };

    for idx in sorted_indices {
        let rule = &rules[idx];
        let truth = (rule.evaluator)(candidate, cfg);
        if !truth.resolves_true() {
            continue;
        }

        // 仅当规则动作优先级严格高于当前已选动作时覆盖（由于已按严重度降序，首次匹配即为最高优先级）
        if rule.action > chosen_action {
            chosen_action = rule.action;
            chosen_truth = truth;
            chosen_rule = rule.id;
            chosen_reason = rule.reason;
        }

        // 终结性拦截（Drop / Tombstone）直接短路结束折叠
        if chosen_action.is_withheld() {
            break;
        }
    }

    // 若策略开关要求将 Interstitial 也直接转为拦截，保持向后可配性
    if cfg.drop_interstitial && chosen_action == ActionKind::Interstitial {
        chosen_action = ActionKind::Drop;
        chosen_reason = "interstitial_dropped_by_policy";
    }

    let downrank_multiplier = compute_downrank_multiplier(
        candidate,
        chosen_action,
        effective_level,
        credibility_exempt,
    );

    VisibilityVerdict {
        action: chosen_action,
        truth: chosen_truth,
        matched_rule: chosen_rule,
        reason: chosen_reason,
        effective_level,
        credibility_exempt,
        fail_open_used,
        used_content_safety_labels,
        downrank_multiplier,
    }
}

/// 基于内置声明式规则目录评估单条候选可见性。
pub fn evaluate_candidate_visibility(
    candidate: &RecommendationCandidatePayload,
    cfg: &VisibilityPolicyConfig,
) -> VisibilityVerdict {
    evaluate_rules_with_precedence(VISIBILITY_RULES, candidate, cfg)
}

/// 供打分侧读取的统一可见性降权乘数（不修改候选原分数字段）。
pub fn visibility_downrank_factor(candidate: &RecommendationCandidatePayload) -> f64 {
    let cfg = VisibilityPolicyConfig::default();
    let verdict = evaluate_candidate_visibility(candidate, &cfg);
    verdict.downrank_multiplier
}

fn compute_downrank_multiplier(
    candidate: &RecommendationCandidatePayload,
    action: ActionKind,
    effective_level: NormalizedRiskLevel,
    credibility_exempt: bool,
) -> f64 {
    if credibility_exempt {
        return 1.0;
    }

    match action {
        ActionKind::Drop | ActionKind::Tombstone => 0.0,
        ActionKind::Interstitial => 0.64,
        ActionKind::Downrank => match effective_level {
            NormalizedRiskLevel::Medium => 0.64,
            NormalizedRiskLevel::LowRisk => 0.90,
            _ => 0.85,
        },
        ActionKind::Allow => {
            if let Some(vf) = candidate.vf_result.as_ref() {
                let level_factor = match vf.level.as_deref() {
                    Some("high_quality") => 1.08,
                    Some("safe") | Some("standard") => 1.0,
                    Some("low_risk") => 0.90,
                    Some("low_quality") => 0.82,
                    Some("medium") | Some("borderline") => 0.64,
                    Some("high") | Some("high_risk") => 0.35,
                    Some("blocked") => 0.05,
                    _ => 1.0,
                };
                let score_factor = vf
                    .score
                    .map(|s| 0.85 + s.clamp(0.0, 1.0) * 0.15)
                    .unwrap_or(1.0);
                (level_factor * score_factor).clamp(0.0, 1.1)
            } else {
                1.0
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::Utc;

    use crate::contracts::{
        CandidateVisibilityPayload, ContentSafetyLabelsPayload, RecommendationCandidatePayload,
    };

    use super::{
        ActionKind, NormalizedRiskLevel, SafetyLevel, Truth, VisibilityPolicyConfig,
        VisibilityRuleSpec, evaluate_candidate_visibility, evaluate_rules_with_precedence,
    };

    fn base_candidate(post_id: &str) -> RecommendationCandidatePayload {
        RecommendationCandidatePayload {
            post_id: post_id.to_string(),
            author_id: "author-1".to_string(),
            content: "visibility test post".to_string(),
            created_at: Utc::now(),
            ..Default::default()
        }
    }

    #[test]
    fn truth_three_valued_logic_laws_hold() {
        let u_t = Truth::Unknown { default: true };
        let u_f = Truth::Unknown { default: false };

        assert!(Truth::True.resolves_true());
        assert!(!Truth::False.resolves_true());
        assert!(u_t.resolves_true());
        assert!(!u_f.resolves_true());

        assert_eq!(Truth::False.and(u_t), Truth::False);
        assert_eq!(Truth::True.and(u_t), u_t);
        assert_eq!(u_t.and(u_f), u_f);
        assert_eq!(Truth::True.or(u_f), Truth::True);
        assert_eq!(Truth::False.or(u_t), u_t);
        assert_eq!(!u_t, u_f);
        assert_eq!(!u_f, u_t);
    }

    #[test]
    fn action_kind_enforces_strict_precedence_even_when_rules_unordered() {
        assert!(ActionKind::Drop > ActionKind::Tombstone);
        assert!(ActionKind::Tombstone > ActionKind::Interstitial);
        assert!(ActionKind::Interstitial > ActionKind::Downrank);
        assert!(ActionKind::Downrank > ActionKind::Allow);

        fn always_true(_: &RecommendationCandidatePayload, _: &VisibilityPolicyConfig) -> Truth {
            Truth::True
        }

        // 故意打乱规则声明顺序，验证引擎严格按 Drop > Tombstone > Interstitial > Downrank > Allow 裁决
        let unordered = [
            VisibilityRuleSpec {
                id: "allow_rule",
                action: ActionKind::Allow,
                reason: "allow",
                evaluator: always_true,
            },
            VisibilityRuleSpec {
                id: "downrank_rule",
                action: ActionKind::Downrank,
                reason: "downrank",
                evaluator: always_true,
            },
            VisibilityRuleSpec {
                id: "interstitial_rule",
                action: ActionKind::Interstitial,
                reason: "interstitial",
                evaluator: always_true,
            },
            VisibilityRuleSpec {
                id: "tombstone_rule",
                action: ActionKind::Tombstone,
                reason: "tombstone",
                evaluator: always_true,
            },
            VisibilityRuleSpec {
                id: "drop_rule",
                action: ActionKind::Drop,
                reason: "drop",
                evaluator: always_true,
            },
        ];

        let verdict = evaluate_rules_with_precedence(
            &unordered,
            &base_candidate("p1"),
            &VisibilityPolicyConfig::default(),
        );
        assert_eq!(verdict.action, ActionKind::Drop);
        assert_eq!(verdict.matched_rule, "drop_rule");

        // 去掉 Drop 后应胜出 Tombstone
        let without_drop = &unordered[..4];
        let verdict_tomb = evaluate_rules_with_precedence(
            without_drop,
            &base_candidate("p2"),
            &VisibilityPolicyConfig::default(),
        );
        assert_eq!(verdict_tomb.action, ActionKind::Tombstone);

        // 去掉 Drop 与 Tombstone 后应胜出 Interstitial
        let without_withheld = &unordered[..3];
        let verdict_inter = evaluate_rules_with_precedence(
            without_withheld,
            &base_candidate("p3"),
            &VisibilityPolicyConfig::default(),
        );
        assert_eq!(verdict_inter.action, ActionKind::Interstitial);
    }

    #[test]
    fn high_cred_author_exempts_mild_low_risk_but_never_nsfw_high_blocked() {
        let cfg = VisibilityPolicyConfig::default();

        // 1. 高信誉作者（>= 0.80）+ low_risk 轻度文本标签 -> 免误伤放行
        let mut mild_high_cred = base_candidate("p-cred-ok");
        mild_high_cred.author_cred_score = Some(0.85);
        mild_high_cred.content_safety_labels = Some(ContentSafetyLabelsPayload {
            safe: false,
            level: Some("low_risk".to_string()),
            labels: vec!["mild_text_trigger".to_string()],
            score: Some(0.75),
            source: Some("async_vf".to_string()),
            assigned_at_ms: Some(1_700_000_000_000),
        });
        let v_ok = evaluate_candidate_visibility(&mild_high_cred, &cfg);
        assert_eq!(v_ok.action, ActionKind::Allow);
        assert!(v_ok.credibility_exempt);
        assert!(!v_ok.should_drop());

        // 2. 低信誉作者（< 0.80）+ low_risk 域外 -> 严格拦截
        let mut mild_low_cred = mild_high_cred.clone();
        mild_low_cred.author_cred_score = Some(0.65);
        let v_low_cred = evaluate_candidate_visibility(&mild_low_cred, &cfg);
        assert_eq!(v_low_cred.action, ActionKind::Drop);
        assert!(!v_low_cred.credibility_exempt);
        assert!(v_low_cred.should_drop());

        // 3. 高信誉作者（1.0）+ nsfw / high / blocked -> 依然严格 Drop！
        for (level, is_nsfw, label) in [
            (Some("high"), None, "spam_high"),
            (Some("blocked"), None, "policy_blocked"),
            (Some("low_risk"), Some(true), "mild_text"),
            (Some("low_risk"), None, "nsfw_media"),
        ] {
            let mut strict = base_candidate("p-strict");
            strict.author_cred_score = Some(1.0);
            strict.is_nsfw = is_nsfw;
            strict.content_safety_labels = Some(ContentSafetyLabelsPayload {
                safe: true,
                level: level.map(ToOwned::to_owned),
                labels: vec![label.to_string()],
                score: Some(0.95),
                source: Some("async_vf".to_string()),
                assigned_at_ms: Some(1_700_000_000_000),
            });
            let v_strict = evaluate_candidate_visibility(&strict, &cfg);
            assert_eq!(
                v_strict.action,
                ActionKind::Drop,
                "level={level:?}, is_nsfw={is_nsfw:?}, label={label}"
            );
            assert!(v_strict.should_drop());
            assert!(!v_strict.credibility_exempt);
        }
    }

    #[test]
    fn evaluates_all_five_vf_levels_and_safety_level_strictness() {
        let cfg = VisibilityPolicyConfig::default();

        let mut safe = base_candidate("p-safe");
        safe.vf_result = Some(CandidateVisibilityPayload {
            safe: true,
            level: Some("safe".to_string()),
            ..Default::default()
        });
        assert_eq!(
            evaluate_candidate_visibility(&safe, &cfg).action,
            ActionKind::Allow
        );

        let mut medium_safe = base_candidate("p-med");
        medium_safe.vf_result = Some(CandidateVisibilityPayload {
            safe: true,
            level: Some("medium".to_string()),
            ..Default::default()
        });
        let v_med = evaluate_candidate_visibility(&medium_safe, &cfg);
        assert_eq!(v_med.action, ActionKind::Interstitial);
        assert_eq!(v_med.effective_level, NormalizedRiskLevel::Medium);

        // FilterAll 下网内未知安全性也必须 fail-closed 拦截
        let mut in_net_unknown = base_candidate("p-in-unknown");
        in_net_unknown.in_network = Some(true);
        let filter_all_cfg = VisibilityPolicyConfig {
            safety_level: SafetyLevel::FilterAll,
            ..cfg
        };
        assert!(evaluate_candidate_visibility(&in_net_unknown, &filter_all_cfg).should_drop());
        assert!(!evaluate_candidate_visibility(&in_net_unknown, &cfg).should_drop());
    }
}
