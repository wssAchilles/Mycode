//! 排序阶梯基础类型、阶段角色枚举与分数拆解容器工具。

use std::collections::HashMap;

use super::validation::validate_ranking_ladder;

/// 排序阶梯契约版本号。
pub const RANKING_LADDER_VERSION: &str = "rust_ranking_ladder_v1";
/// 排序分数角色契约版本号。
pub const RANKING_SCORE_ROLE_VERSION: &str = "ranking_score_role_v1";

/// 候选项 `score_breakdown` 哈希表的默认初始容量，避免高频扩容分配。
pub const SCORE_BREAKDOWN_INITIAL_CAPACITY: usize = 16;

/// 创建预分配初始容量的分数明细映射表。
pub fn new_score_breakdown_map() -> HashMap<String, f64> {
    HashMap::with_capacity(SCORE_BREAKDOWN_INITIAL_CAPACITY)
}

/// 排序阶段类别。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RankingStageKind {
    /// 模型打分阶段（生成各行为概率头）。
    ModelScores,
    /// 加权聚合阶段（生成 `weighted_score`）。
    WeightedScore,
    /// 权重调整阶段（在加权分与最终分之间进行校准与衰减）。
    ScoreAdjustment,
    /// 最终分生成阶段（生成 `score`）。
    FinalScore,
    /// 元数据或契约校验阶段（不改写排名分）。
    Metadata,
}

impl RankingStageKind {
    /// 返回阶段类别的稳定协议字符串标识。
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ModelScores => "model_scores",
            Self::WeightedScore => "weighted_score",
            Self::ScoreAdjustment => "score_adjustment",
            Self::FinalScore => "final_score",
            Self::Metadata => "metadata",
        }
    }
}

/// 排序阶段在分数生命周期中所承担的写职责角色。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RankingScoreRole {
    /// 生成模型多头原始预测分数。
    ModelScoreGeneration,
    /// 创建初始加权分数。
    WeightedScoreCreation,
    /// 调整或缩放已有的加权分数。
    WeightedScoreAdjustment,
    /// 生成最终用于排序截断的得分。
    FinalScoreCreation,
    /// 仅记录审计元数据，不修改候选分数。
    MetadataOnly,
}

impl RankingScoreRole {
    /// 返回分数角色的稳定协议字符串标识。
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ModelScoreGeneration => "model_score_generation",
            Self::WeightedScoreCreation => "weighted_score_creation",
            Self::WeightedScoreAdjustment => "weighted_score_adjustment",
            Self::FinalScoreCreation => "final_score_creation",
            Self::MetadataOnly => "metadata_only",
        }
    }
}

/// 单个排序阶段的声明式契约规格。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RankingStageSpec {
    /// 阶段名称。
    pub stage_name: &'static str,
    /// 阶段类别。
    pub kind: RankingStageKind,
    /// 是否允许写入 `weighted_score`。
    pub writes_weighted_score: bool,
    /// 是否允许写入最终 `score`。
    pub writes_final_score: bool,
    /// 是否为模型打分降级兜底阶段。
    pub fallback_model_scorer: bool,
}

/// 完整的排序执行阶梯计划。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RankingLadderPlan {
    /// 阶梯版本号。
    pub version: &'static str,
    /// 按执行顺序排列的阶段规格列表。
    pub specs: Vec<RankingStageSpec>,
}

/// 融合调整组规格（要求组内阶段在阶梯中连续且同属 `ScoreAdjustment`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RankingAdjustmentGroupSpec {
    /// 融合组名称。
    pub group_name: &'static str,
    /// 组内包含的阶段名称有序列表。
    pub stage_names: &'static [&'static str],
}

impl RankingAdjustmentGroupSpec {
    /// 构造一个新的融合调整组规格。
    pub const fn new(group_name: &'static str, stage_names: &'static [&'static str]) -> Self {
        Self {
            group_name,
            stage_names,
        }
    }
}

impl RankingLadderPlan {
    /// 使用默认契约版本构建排序阶梯计划。
    pub fn new(specs: Vec<RankingStageSpec>) -> Self {
        Self {
            version: RANKING_LADDER_VERSION,
            specs,
        }
    }

    /// 校验当前阶梯计划是否满足全部阶段顺序与写权限不变量。
    pub fn validate(&self) -> Result<(), String> {
        validate_ranking_ladder(&self.specs)
    }

    /// 提取所有阶段名称列表。
    pub fn stage_names(&self) -> Vec<String> {
        self.specs
            .iter()
            .map(|spec| spec.stage_name.to_string())
            .collect()
    }
}

impl RankingStageSpec {
    /// 构造单个排序阶段契约规格。
    pub const fn new(
        stage_name: &'static str,
        kind: RankingStageKind,
        writes_weighted_score: bool,
        writes_final_score: bool,
        fallback_model_scorer: bool,
    ) -> Self {
        Self {
            stage_name,
            kind,
            writes_weighted_score,
            writes_final_score,
            fallback_model_scorer,
        }
    }

    /// 将阶段类别映射为规范分数写入角色。
    pub const fn score_role(self) -> RankingScoreRole {
        match self.kind {
            RankingStageKind::ModelScores => RankingScoreRole::ModelScoreGeneration,
            RankingStageKind::WeightedScore => RankingScoreRole::WeightedScoreCreation,
            RankingStageKind::ScoreAdjustment => RankingScoreRole::WeightedScoreAdjustment,
            RankingStageKind::FinalScore => RankingScoreRole::FinalScoreCreation,
            RankingStageKind::Metadata => RankingScoreRole::MetadataOnly,
        }
    }
}
