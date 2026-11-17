//! 轻量级 Point-In-Time (PIT) 用户消偏存储与无锁快照句柄。

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::value_model::{V3_HEAD_COUNT, V3PhoenixPredictions};

use super::logit::{DEFAULT_DEBIAS_CLIP_LOGIT, recenter_probability};

/// 离线消偏产物默认最大允许年龄（秒，对标 X 默认 `3600s`）。
pub const DEFAULT_DEBIAS_MAX_ARTIFACT_AGE_SECS: f64 = 3600.0;

/// 单条用户的 Point-In-Time (PIT) 14 维行为偏置快照。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct UserDebiasEntry {
    /// 该条偏置特征截止统计的毫秒时间戳（严守 PIT：`<= req_ms` 方可使用）。
    pub timestamp_ms: i64,
    /// 与 `V3_HEAD_NAMES` 顺序对齐的 14 路行为 Logit 偏置（`user_logit - global_logit`）。
    pub action_biases: [f64; V3_HEAD_COUNT],
}

/// 消偏跳过原因枚举（对应可观测降级指标标签）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DebiasSkipReason {
    /// 离线产物未加载。
    ArtifactNotLoaded,
    /// 产物超过 `max_artifact_age_secs` 阈值，自动跳过回退。
    StaleArtifact,
    /// 裁剪或混合参数非法（非有限或负数）。
    InvalidParams,
    /// 当前用户在消偏表中无记录。
    UserNotFound,
    /// 该用户在请求时间戳 `req_ms` 及以前没有任何可用 PIT 条目。
    NoPitEntry,
}

impl DebiasSkipReason {
    /// 返回稳定可观测指标标签名称。
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ArtifactNotLoaded => "artifact_not_loaded",
            Self::StaleArtifact => "stale_artifact",
            Self::InvalidParams => "invalid_params",
            Self::UserNotFound => "user_not_found",
            Self::NoPitEntry => "no_pit_entry",
        }
    }
}

/// 单次消偏执行结果状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DebiasOutcome {
    /// 已成功应用 Logit 空间重中心化。
    Applied,
    /// 因过期或缺失 PIT 记录而跳过并保留原始预测概率。
    Skipped(DebiasSkipReason),
}

/// 轻量级内存用户消偏表，支持 PIT 截断与过期自动跳过。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct UserDebiasStore {
    /// 离线消偏产物训练/产出时间戳（Epoch 毫秒）。
    pub trained_at_ms: i64,
    /// 产物允许的最大年龄（秒）；`> 0.0` 时超限即触发过期跳过，`0.0` 表示关闭过期校验。
    pub max_artifact_age_secs: f64,
    /// 默认 Logit 裁剪幅度 `clip`。
    pub default_clip: f64,
    /// 默认重中心化平滑系数 `alpha in [0.0, 1.0]`（`1.0` 为全量消偏）。
    pub default_alpha: f64,
    /// 按 `user_id` 索引、按 `timestamp_ms` 升序排列的偏置历史序列。
    entries_by_user: HashMap<String, Vec<UserDebiasEntry>>,
}

impl Default for UserDebiasStore {
    fn default() -> Self {
        Self {
            trained_at_ms: 0,
            max_artifact_age_secs: DEFAULT_DEBIAS_MAX_ARTIFACT_AGE_SECS,
            default_clip: DEFAULT_DEBIAS_CLIP_LOGIT,
            default_alpha: 1.0,
            entries_by_user: HashMap::new(),
        }
    }
}

impl UserDebiasStore {
    /// 创建指定训练时间戳与产物过期阈值的空消偏存储。
    pub fn new(trained_at_ms: i64, max_artifact_age_secs: f64) -> Self {
        Self {
            trained_at_ms,
            max_artifact_age_secs,
            default_clip: DEFAULT_DEBIAS_CLIP_LOGIT,
            default_alpha: 1.0,
            entries_by_user: HashMap::new(),
        }
    }

    /// 链式配置默认 Logit 裁剪阈值与平滑混合系数。
    pub fn with_clip_and_alpha(mut self, clip: f64, alpha: f64) -> Self {
        self.default_clip = clip;
        self.default_alpha = alpha;
        self
    }

    /// 向存储中写入或更新某用户在指定时间点的 14 维偏置条目（保持按时间升序）。
    pub fn insert_entry(&mut self, user_id: impl Into<String>, entry: UserDebiasEntry) {
        let entries = self.entries_by_user.entry(user_id.into()).or_default();
        match entries.binary_search_by_key(&entry.timestamp_ms, |e| e.timestamp_ms) {
            Ok(pos) => entries[pos] = entry,
            Err(pos) => entries.insert(pos, entry),
        }
    }

    /// 严格按请求时间戳 `req_ms` 执行 PIT 截断，丢弃所有 `timestamp_ms > req_ms` 的未来条目。
    ///
    /// 用于缓存重用请求或离线回放时防止时间穿越泄漏。
    pub fn retain_until(&mut self, req_ms: i64) {
        self.entries_by_user.retain(|_, entries| {
            retain_entries_until(entries, req_ms);
            !entries.is_empty()
        });
    }

    /// 判断当前消偏产物在 `now_ms` 时刻是否已超过 `max_artifact_age_secs`。
    pub fn is_stale(&self, now_ms: i64) -> bool {
        if !self.max_artifact_age_secs.is_finite() || self.max_artifact_age_secs < 0.0 {
            return true;
        }
        if self.max_artifact_age_secs == 0.0 {
            return false;
        }
        let age_ms = now_ms.saturating_sub(self.trained_at_ms);
        (age_ms as f64) > self.max_artifact_age_secs * 1000.0
    }

    /// 在不修改内部状态的前提下，二分查询用户在 `req_ms` 及以前最新的有效 PIT 条目。
    pub fn entry_for_user(&self, user_id: &str, req_ms: i64) -> Option<&UserDebiasEntry> {
        let entries = self.entries_by_user.get(user_id)?;
        let count = entries.partition_point(|e| e.timestamp_ms <= req_ms);
        count.checked_sub(1).and_then(|idx| entries.get(idx))
    }

    /// 校验产物新鲜度与 PIT 边界后返回当前请求可用的 14 维偏置向量，异常或过期则安全回退 `Err`。
    pub fn biases_for_user(
        &self,
        user_id: &str,
        req_ms: i64,
        now_ms: i64,
    ) -> Result<[f64; V3_HEAD_COUNT], DebiasSkipReason> {
        if !self.default_clip.is_finite()
            || self.default_clip < 0.0
            || !self.default_alpha.is_finite()
            || !(0.0..=1.0).contains(&self.default_alpha)
        {
            return Err(DebiasSkipReason::InvalidParams);
        }
        if self.is_stale(now_ms) {
            return Err(DebiasSkipReason::StaleArtifact);
        }
        let Some(entries) = self.entries_by_user.get(user_id) else {
            return Err(DebiasSkipReason::UserNotFound);
        };
        let count = entries.partition_point(|e| e.timestamp_ms <= req_ms);
        let Some(entry) = count.checked_sub(1).and_then(|idx| entries.get(idx)) else {
            return Err(DebiasSkipReason::NoPitEntry);
        };
        let mut sanitized = entry.action_biases;
        for bias in &mut sanitized {
            if !bias.is_finite() {
                *bias = 0.0;
            }
        }
        Ok(sanitized)
    }

    /// 对单个概率头执行 PIT 检验与 Logit 空间消偏，若跳过则原样返回 `prob`。
    pub fn debias_head(
        &self,
        user_id: &str,
        head_index: usize,
        prob: f64,
        req_ms: i64,
        now_ms: i64,
    ) -> f64 {
        if head_index >= V3_HEAD_COUNT {
            return prob;
        }
        let Ok(biases) = self.biases_for_user(user_id, req_ms, now_ms) else {
            return prob;
        };
        recenter_probability(
            prob,
            biases[head_index],
            self.default_alpha,
            self.default_clip,
        )
    }

    /// 对 14 维动作概率数组就地执行 Logit 重中心化；过期或无有效 PIT 记录时保持原数组不变。
    pub fn debias_action_probs(
        &self,
        user_id: &str,
        probs: &mut [f64; V3_HEAD_COUNT],
        req_ms: i64,
        now_ms: i64,
    ) -> DebiasOutcome {
        let biases = match self.biases_for_user(user_id, req_ms, now_ms) {
            Ok(b) => b,
            Err(reason) => return DebiasOutcome::Skipped(reason),
        };
        for (prob, bias) in probs.iter_mut().zip(biases) {
            *prob = recenter_probability(*prob, bias, self.default_alpha, self.default_clip);
        }
        DebiasOutcome::Applied
    }

    /// 对 `V3PhoenixPredictions` 14 个概率头就地执行消偏，不修改连续停留期望秒数。
    pub fn debias_predictions(
        &self,
        user_id: &str,
        predictions: &mut V3PhoenixPredictions,
        req_ms: i64,
        now_ms: i64,
    ) -> DebiasOutcome {
        let mut heads = predictions.to_head_array();
        let outcome = self.debias_action_probs(user_id, &mut heads, req_ms, now_ms);
        if outcome == DebiasOutcome::Applied {
            predictions.apply_head_array(heads);
        }
        outcome
    }

    /// 返回当前消偏表中包含的用户数量。
    pub fn user_count(&self) -> usize {
        self.entries_by_user.len()
    }

    /// 返回所有用户条目总数。
    pub fn total_entries(&self) -> usize {
        self.entries_by_user.values().map(Vec::len).sum()
    }

    /// 从 JSON 字节反序列化消偏表并自动规范各用户的升序时间戳顺序。
    pub fn from_json_bytes(bytes: &[u8]) -> Result<Self, serde_json::Error> {
        let mut store: Self = serde_json::from_slice(bytes)?;
        for entries in store.entries_by_user.values_mut() {
            entries.sort_by_key(|e| e.timestamp_ms);
        }
        Ok(store)
    }

    /// 从 JSON 字符串反序列化消偏表。
    pub fn from_json_str(raw: &str) -> Result<Self, serde_json::Error> {
        Self::from_json_bytes(raw.as_bytes())
    }

    /// 序列化为 JSON 字符串用于持久化或离线导出。
    pub fn to_json_string(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

/// 对有序或无序条目的切片列表执行就地 PIT 截断（仅保留 `timestamp_ms <= req_ms`）。
pub fn retain_entries_until(entries: &mut Vec<UserDebiasEntry>, req_ms: i64) {
    entries.retain(|entry| entry.timestamp_ms <= req_ms);
}

/// 线程安全的轻量级在线热加载快照句柄（含字节指纹去重）。
#[derive(Debug, Default)]
pub struct UserDebiasSnapshotHandle {
    store: RwLock<Option<Arc<UserDebiasStore>>>,
    loaded_fingerprint: RwLock<u64>,
}

impl UserDebiasSnapshotHandle {
    /// 创建空的消偏快照句柄。
    pub fn empty() -> Self {
        Self::default()
    }

    /// 读取当前最新消偏快照。
    pub fn snapshot(&self) -> Option<Arc<UserDebiasStore>> {
        self.store
            .read()
            .ok()
            .and_then(|guard| guard.as_ref().map(Arc::clone))
    }

    /// 基于字节指纹去重热更新消偏快照；内容未变化时跳过解析并返回 `false`。
    pub fn reload_from_bytes(&self, bytes: &[u8]) -> Result<bool, String> {
        let fp = bytes_fingerprint(bytes);
        let unchanged = self.snapshot().is_some()
            && self
                .loaded_fingerprint
                .read()
                .map(|guard| *guard == fp)
                .unwrap_or(false);
        if unchanged {
            return Ok(false);
        }
        let parsed = UserDebiasStore::from_json_bytes(bytes).map_err(|e| format!("parse: {e}"))?;
        if let Ok(mut guard) = self.store.write() {
            *guard = Some(Arc::new(parsed));
        }
        if let Ok(mut fp_guard) = self.loaded_fingerprint.write() {
            *fp_guard = fp;
        }
        Ok(true)
    }

    /// 从磁盘 JSON 文件路径加载或热更新消偏快照。
    pub fn reload_from_path(&self, path: &Path) -> Result<bool, String> {
        let bytes = std::fs::read(path).map_err(|e| format!("read: {e}"))?;
        self.reload_from_bytes(&bytes)
    }
}

/// 返回当前系统 Epoch 毫秒时间戳。
pub fn current_epoch_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

fn bytes_fingerprint(bytes: &[u8]) -> u64 {
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    hasher.finish()
}
