mod contracts;
mod evaluator;

pub use contracts::{
    REPLAY_FIXTURE_VERSION, REPLAY_SCENARIO_MANIFEST_VERSION, RecommendationReplayFixturePayload,
    RecommendationReplayScenarioManifestPayload, RecommendationReplayScenarioPayload,
    ReplayExpectedPropertiesPayload,
};
pub use evaluator::{ReplayEvaluationResult, evaluate_replay_fixture, evaluate_scenario};

#[cfg(test)]
mod tests;
