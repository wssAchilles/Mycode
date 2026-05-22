use std::time::Duration;

use super::RecallPhase;

/// Result from a recall phase execution
#[derive(Debug)]
pub struct PhaseResult {
    pub phase: RecallPhase,
    pub candidates: Vec<super::PhaseCandidate>,
    pub latency: Duration,
    pub source_count: usize,
}

/// Merge strategy for combining candidates from different phases
#[derive(Debug, Clone, Copy)]
pub enum MergeStrategy {
    /// Keep all candidates, deduplicate by ID
    Union,
    /// Replace lower-confidence candidates with higher-confidence ones
    ConfidenceBased,
    /// Score-weighted merge
    ScoreWeighted,
}

impl Default for MergeStrategy {
    fn default() -> Self {
        Self::ConfidenceBased
    }
}
