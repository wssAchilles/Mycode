#[derive(Debug, Clone, Copy)]
pub(crate) struct ScoringPolicy {
    pub version: &'static str,
    pub freshness_half_life_hours: f64,
    pub relevance: RelevanceWeights,
    pub action: ActionEstimatorWeights,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct RelevanceWeights {
    pub source_evidence: f64,
    pub network: f64,
    pub author_affinity: f64,
    pub topic_affinity: f64,
    pub source_affinity: f64,
    pub conversation_affinity: f64,
    pub popularity: f64,
    pub freshness: f64,
    pub quality: f64,
    pub temporal_interest: f64,
    pub content_kind: f64,
    pub trend: f64,
    pub source_quality: f64,
    pub negative_feedback_penalty: f64,
    pub delivery_fatigue_penalty: f64,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ActionEstimatorWeights {
    pub negative_quality_gap: f64,
    pub negative_delivery_fatigue: f64,
    pub negative_source_quality_gap: f64,
    pub negative_nsfw: f64,
    pub click: ActionFormulaWeights,
    pub like: ActionFormulaWeights,
    pub reply: ActionFormulaWeights,
    pub repost: ActionFormulaWeights,
    pub dwell: ActionFormulaWeights,
}

#[derive(Debug, Clone, Copy)]
pub(crate) struct ActionFormulaWeights {
    pub base: f64,
    pub relevance: f64,
    pub source_evidence: f64,
    pub media: f64,
    pub content_kind: f64,
    pub trend: f64,
    pub author_affinity: f64,
    pub quality: f64,
    pub stable_interest: f64,
    pub network: f64,
    pub social_lane: f64,
    pub conversation_affinity: f64,
    pub content_length: f64,
    pub popularity: f64,
    pub freshness: f64,
    pub source_quality: f64,
    pub negative_penalty: f64,
}

pub(crate) const SCORING_POLICY_V1: ScoringPolicy = ScoringPolicy {
    version: "lightweight_phoenix_policy_v2",
    freshness_half_life_hours: 12.0,
    relevance: RelevanceWeights {
        // ── 正向信号: 归一化到总和=1.0 (原总和1.44, 除以1.44) ──
        source_evidence: 0.14,       // 召回来源可信度
        network: 0.10,               // 社交关系 (关注/扩展)
        author_affinity: 0.11,       // 用户对作者的历史偏好
        topic_affinity: 0.10,        // 用户对话题的历史偏好
        source_affinity: 0.03,       // 用户对来源的历史偏好
        conversation_affinity: 0.03, // 用户对对话线程的偏好
        popularity: 0.07,            // 互动率 + 量级
        freshness: 0.10,             // 时效性 (统一半衰期12h, 与recency_scorer一致)
        quality: 0.10,               // 内容质量
        temporal_interest: 0.07,     // 短期兴趣 + 长期兴趣
        content_kind: 0.03,          // 内容类型 (新闻/媒体)
        trend: 0.07,                 // 趋势热度
        source_quality: 0.04,        // 来源质量
        // ── 负向信号: 等比缩放 (原0.36, 除以1.44) ──
        negative_feedback_penalty: 0.17,
        delivery_fatigue_penalty: 0.08,
    },
    action: ActionEstimatorWeights {
        negative_quality_gap: 0.08,
        negative_delivery_fatigue: 0.16,
        negative_source_quality_gap: 0.04,
        negative_nsfw: 0.18,
        click: ActionFormulaWeights {
            base: 0.03,
            relevance: 0.32,
            source_evidence: 0.08,
            media: 0.05,
            content_kind: 0.04,
            trend: 0.03,
            author_affinity: 0.0,
            quality: 0.0,
            stable_interest: 0.0,
            network: 0.0,
            social_lane: 0.0,
            conversation_affinity: 0.0,
            content_length: 0.0,
            popularity: 0.0,
            freshness: 0.0,
            source_quality: 0.0,
            negative_penalty: 0.2,
        },
        like: ActionFormulaWeights {
            base: 0.02,
            relevance: 0.22,
            source_evidence: 0.0,
            media: 0.0,
            content_kind: 0.0,
            trend: 0.0,
            author_affinity: 0.11,
            quality: 0.06,
            stable_interest: 0.04,
            network: 0.0,
            social_lane: 0.0,
            conversation_affinity: 0.0,
            content_length: 0.0,
            popularity: 0.0,
            freshness: 0.0,
            source_quality: 0.0,
            negative_penalty: 0.18,
        },
        reply: ActionFormulaWeights {
            base: 0.01,
            relevance: 0.08,
            source_evidence: 0.0,
            media: 0.0,
            content_kind: 0.0,
            trend: 0.0,
            author_affinity: 0.1,
            quality: 0.0,
            stable_interest: 0.0,
            network: 0.06,
            social_lane: 0.1,
            conversation_affinity: 0.07,
            content_length: 0.04,
            popularity: 0.0,
            freshness: 0.0,
            source_quality: 0.0,
            negative_penalty: 0.16,
        },
        repost: ActionFormulaWeights {
            base: 0.008,
            relevance: 0.12,
            source_evidence: 0.06,
            media: 0.0,
            content_kind: 0.05,
            trend: 0.08,
            author_affinity: 0.0,
            quality: 0.08,
            stable_interest: 0.0,
            network: 0.0,
            social_lane: 0.0,
            conversation_affinity: 0.0,
            content_length: 0.0,
            popularity: 0.1,
            freshness: 0.0,
            source_quality: 0.0,
            negative_penalty: 0.16,
        },
        dwell: ActionFormulaWeights {
            base: 0.04,
            relevance: 0.18,
            source_evidence: 0.0,
            media: 0.1,
            content_kind: 0.06,
            trend: 0.0,
            author_affinity: 0.0,
            quality: 0.22,
            stable_interest: 0.0,
            network: 0.0,
            social_lane: 0.0,
            conversation_affinity: 0.0,
            content_length: 0.0,
            popularity: 0.0,
            freshness: 0.04,
            source_quality: 0.03,
            negative_penalty: 0.12,
        },
    },
};

pub(crate) fn current_scoring_policy() -> &'static ScoringPolicy {
    &SCORING_POLICY_V1
}
