mod contracts;
mod evaluator;

pub use contracts::ReplayEvaluationResultPayload as ReplayEvaluationResult;
pub use contracts::{
    REPLAY_FIXTURE_VERSION, REPLAY_SCENARIO_MANIFEST_VERSION, RecommendationReplayFixturePayload,
    RecommendationReplayScenarioManifestPayload, RecommendationReplayScenarioPayload,
    ReplayEvaluationResultPayload, ReplayExpectedPropertiesPayload,
};
pub use evaluator::{evaluate_replay_fixture, evaluate_scenario};

#[cfg(test)]
mod tests;
