import type { PredictionArtifactV1 } from '../../ope/contracts';
import type { VerifiedPredictionSetMemberV1 } from './verify';

export function projectVerifiedPredictionMemberToV1(
  member: VerifiedPredictionSetMemberV1,
): PredictionArtifactV1 {
  return {
    decisionId: member.decisionId,
    decisionLogSha256: member.decisionLogSha256,
    candidatePoolSha256: member.candidatePoolSha256,
    datasetVersion: member.datasetVersion,
    artifactVersion: member.predictionSetVersion,
    objective: member.objective,
    rewardDefinitionVersion: member.rewardDefinitionVersion,
    horizonMs: member.horizonMs,
    predictions: member.predictions.map(({ actionKey, qHat }) => ({ actionKey, qHat })),
  };
}
