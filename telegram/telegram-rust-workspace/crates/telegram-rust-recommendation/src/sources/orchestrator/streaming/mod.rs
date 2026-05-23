pub mod phase_runner;
pub mod types;

use crate::contracts::RecommendationCandidatePayload;

/// Phase identifier for recall pipeline
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum RecallPhase {
    /// Phase 1: Fast recall from graph and cached sources (<20ms)
    Fast,
    /// Phase 2: Rich recall from ML models (<100ms)
    Rich,
    /// Phase 3: Rerank with all scorers (<50ms)
    Rerank,
}

/// Candidate with phase metadata
#[derive(Debug, Clone)]
pub struct PhaseCandidate {
    pub candidate: RecommendationCandidatePayload,
    pub phase: RecallPhase,
    pub confidence: f64,
}

/// Configuration for streaming recall
#[derive(Debug, Clone)]
pub struct StreamingRecallConfig {
    pub fast_phase_timeout_ms: u64,
    pub rich_phase_timeout_ms: u64,
    pub channel_buffer_size: usize,
    pub min_candidates_for_early_scoring: usize,
}

impl Default for StreamingRecallConfig {
    fn default() -> Self {
        Self {
            fast_phase_timeout_ms: 20,
            rich_phase_timeout_ms: 100,
            channel_buffer_size: 256,
            min_candidates_for_early_scoring: 10,
        }
    }
}
