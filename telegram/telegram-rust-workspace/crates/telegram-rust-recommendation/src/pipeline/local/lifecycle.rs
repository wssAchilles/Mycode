use std::time::Instant;

use serde::{Deserialize, Serialize};
use tracing::{Span, info, info_span};

/// Stages of the recommendation request lifecycle.
#[derive(Debug, Clone, Copy, Hash, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LifecycleStage {
    QueryHydration,
    CandidateRetrieval,
    Filtering,
    Scoring,
    HeuristicRescoring,
    ListwiseReranking,
    Selection,
    Blending,
    SideEffects,
    Response,
}

impl LifecycleStage {
    pub fn all() -> &'static [LifecycleStage] {
        &[
            Self::QueryHydration,
            Self::CandidateRetrieval,
            Self::Filtering,
            Self::Scoring,
            Self::HeuristicRescoring,
            Self::ListwiseReranking,
            Self::Selection,
            Self::Blending,
            Self::SideEffects,
            Self::Response,
        ]
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::QueryHydration => "query_hydration",
            Self::CandidateRetrieval => "candidate_retrieval",
            Self::Filtering => "filtering",
            Self::Scoring => "scoring",
            Self::HeuristicRescoring => "heuristic_rescoring",
            Self::ListwiseReranking => "listwise_reranking",
            Self::Selection => "selection",
            Self::Blending => "blending",
            Self::SideEffects => "side_effects",
            Self::Response => "response",
        }
    }
}

/// Timing information for a single lifecycle stage.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageTiming {
    pub stage: LifecycleStage,
    pub duration_ms: f64,
}

/// Request lifecycle tracker for structured tracing.
///
/// Creates tracing spans for each pipeline stage and records timing
/// for performance analysis. Supports Jaeger/Zipkin via tracing subscribers.
pub struct RequestLifecycle {
    request_id: String,
    user_id: String,
    started_at: Instant,
    timings: Vec<StageTiming>,
    current_stage: Option<(LifecycleStage, Instant)>,
}

impl RequestLifecycle {
    pub fn new(request_id: impl Into<String>, user_id: impl Into<String>) -> Self {
        let request_id = request_id.into();
        let user_id = user_id.into();

        info!(
            request_id = %request_id,
            user_id = %user_id,
            "Request lifecycle started"
        );

        Self {
            request_id,
            user_id,
            started_at: Instant::now(),
            timings: Vec::new(),
            current_stage: None,
        }
    }

    /// Begin a new lifecycle stage. Returns a tracing Span that should be held
    /// for the duration of the stage.
    pub fn begin_stage(&mut self, stage: LifecycleStage) -> Span {
        // Close previous stage if any.
        self.end_current_stage();

        let span = info_span!(
            "lifecycle_stage",
            request_id = %self.request_id,
            user_id = %self.user_id,
            stage = stage.as_str(),
        );

        self.current_stage = Some((stage, Instant::now()));

        span
    }

    /// End the current stage (called automatically by begin_stage or finish).
    fn end_current_stage(&mut self) {
        if let Some((stage, started)) = self.current_stage.take() {
            let duration = started.elapsed();
            self.timings.push(StageTiming {
                stage,
                duration_ms: duration.as_secs_f64() * 1000.0,
            });
        }
    }

    /// Finish the lifecycle and return all timings.
    pub fn finish(mut self) -> Vec<StageTiming> {
        self.end_current_stage();

        let total_ms = self.started_at.elapsed().as_secs_f64() * 1000.0;

        info!(
            request_id = %self.request_id,
            user_id = %self.user_id,
            total_duration_ms = format!("{:.2}", total_ms),
            stage_count = self.timings.len(),
            "Request lifecycle completed"
        );

        self.timings
    }

    /// Get total elapsed time in milliseconds.
    pub fn total_elapsed_ms(&self) -> f64 {
        self.started_at.elapsed().as_secs_f64() * 1000.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn lifecycle_records_stage_timings() {
        let mut lifecycle = RequestLifecycle::new("req-1", "user-1");

        {
            let _span = lifecycle.begin_stage(LifecycleStage::QueryHydration);
            thread::sleep(Duration::from_millis(10));
        }
        {
            let _span = lifecycle.begin_stage(LifecycleStage::CandidateRetrieval);
            thread::sleep(Duration::from_millis(10));
        }

        let timings = lifecycle.finish();
        assert_eq!(timings.len(), 2);
        assert_eq!(timings[0].stage, LifecycleStage::QueryHydration);
        assert_eq!(timings[1].stage, LifecycleStage::CandidateRetrieval);
        assert!(timings[0].duration_ms >= 5.0);
        assert!(timings[1].duration_ms >= 5.0);
    }

    #[test]
    fn lifecycle_tracks_total_time() {
        let lifecycle = RequestLifecycle::new("req-1", "user-1");
        thread::sleep(Duration::from_millis(5));
        assert!(lifecycle.total_elapsed_ms() >= 3.0);
    }

    #[test]
    fn lifecycle_stage_as_str() {
        assert_eq!(LifecycleStage::QueryHydration.as_str(), "query_hydration");
        assert_eq!(
            LifecycleStage::HeuristicRescoring.as_str(),
            "heuristic_rescoring"
        );
    }

    #[test]
    fn all_stages_listed() {
        assert_eq!(LifecycleStage::all().len(), 10);
    }
}
