use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use anyhow::Result;
use tokio::sync::mpsc;

use super::{PhaseCandidate, RecallPhase, StreamingRecallConfig};\nuse super::types::MergeStrategy;
use super::types::PhaseResult;
use crate::contracts::{RecommendationCandidatePayload, RecommendationQueryPayload};

/// Runs multiple recall phases with streaming merge
pub struct PhaseRunner {
    config: StreamingRecallConfig,
    merge_strategy: MergeStrategy,
}

impl PhaseRunner {
    pub fn new(config: StreamingRecallConfig, merge_strategy: MergeStrategy) -> Self {
        Self {
            config,
            merge_strategy,
        }
    }

    /// Execute phases with streaming merge
    /// Phase 1 candidates are emitted immediately, Phase 2 candidates are merged as they arrive
    pub async fn run_streaming<F1, F2, Fut1, Fut2>(
        &self,
        fast_phase: F1,
        rich_phase: F2,
    ) -> Result<Vec<PhaseCandidate>>
    where
        F1: FnOnce() -> Fut1 + Send + 'static,
        F2: FnOnce() -> Fut2 + Send + 'static,
        Fut1: std::future::Future<Output = Result<Vec<PhaseCandidate>>> + Send,
        Fut2: std::future::Future<Output = Result<Vec<PhaseCandidate>>> + Send,
    {
        let (tx, mut rx) = mpsc::channel(self.config.channel_buffer_size);
        let tx2 = tx.clone();

        // Spawn Phase 1 (fast recall)
        let fast_handle = tokio::spawn(async move {
            let start = Instant::now();
            let candidates = fast_phase().await?;
            let latency = start.elapsed();

            let result = PhaseResult {
                phase: RecallPhase::Fast,
                candidates,
                latency,
                source_count: 1,
            };

            tx.send(result).await.map_err(|e| anyhow::anyhow!("channel send error: {}", e))?;
            Ok::<(), anyhow::Error>(())
        });

        // Spawn Phase 2 (rich recall)
        let rich_handle = tokio::spawn(async move {
            let start = Instant::now();
            let candidates = rich_phase().await?;
            let latency = start.elapsed();

            let result = PhaseResult {
                phase: RecallPhase::Rich,
                candidates,
                latency,
                source_count: 1,
            };

            tx2.send(result).await.map_err(|e| anyhow::anyhow!("channel send error: {}", e))?;
            Ok::<(), anyhow::Error>(())
        });

        // Collect results as they arrive
        let mut all_candidates = Vec::new();
        let mut seen_ids = HashSet::new();

        while let Some(result) = rx.recv().await {
            for candidate in result.candidates {
                let candidate_id = candidate.candidate.post_id.clone();
                if seen_ids.insert(candidate_id) {
                    all_candidates.push(candidate);
                }
            }
        }

        // Wait for both phases to complete
        let _ = fast_handle.await?;
        let _ = rich_handle.await?;

        Ok(all_candidates)
    }

    /// Merge candidates from two phases based on strategy
    pub fn merge_candidates(
        &self,
        existing: &mut Vec<PhaseCandidate>,
        new_candidates: Vec<PhaseCandidate>,
    ) {
        match self.merge_strategy {
            MergeStrategy::Union => {
                let existing_ids: HashSet<_> = existing
                    .iter()
                    .map(|c| c.candidate.post_id.clone())
                    .collect();
                for candidate in new_candidates {
                    if !existing_ids.contains(&candidate.candidate.post_id) {
                        existing.push(candidate);
                    }
                }
            }
            MergeStrategy::ConfidenceBased => {
                let mut id_map: HashMap<String, usize> = HashMap::new();
                for (i, c) in existing.iter().enumerate() {
                    id_map.insert(c.candidate.post_id.clone(), i);
                }

                for candidate in new_candidates {
                    if let Some(&idx) = id_map.get(&candidate.candidate.post_id) {
                        if candidate.confidence > existing[idx].confidence {
                            existing[idx] = candidate;
                        }
                    } else {
                        id_map.insert(candidate.candidate.post_id.clone(), existing.len());
                        existing.push(candidate);
                    }
                }
            }
            MergeStrategy::ScoreWeighted => {
                // Keep higher-confidence candidate; do not mutate ranking-owned fields
                let mut id_map: HashMap<String, usize> = HashMap::new();
                for (i, c) in existing.iter().enumerate() {
                    id_map.insert(c.candidate.post_id.clone(), i);
                }

                for candidate in new_candidates {
                    if let Some(&idx) = id_map.get(&candidate.candidate.post_id) {
                        if candidate.confidence > existing[idx].confidence {
                            existing[idx] = candidate;
                        }
                    } else {
                        id_map.insert(candidate.candidate.post_id.clone(), existing.len());
                        existing.push(candidate);
                    }
                }
            }
        }
    }
}
