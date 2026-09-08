import { describe, expect, it } from 'vitest';

import {
  isVerifiedSyntheticCohortTrajectoryEvidenceV1,
  verifySyntheticCohortTrajectoryEvidenceV1,
} from '../../src/services/recommendation/offlinePrediction/streamingV3';
import {
  buildPhase17SyntheticViewerClusterMappingAuditV1,
  isVerifiedPhase17SyntheticViewerClusterMappingAuditV1,
} from '../../src/services/recommendation/ope/inference/qualification/v7/clusterMapping';
import {
  buildPhase17SameProcessNoCandidateHandoffV1,
  isVerifiedPhase17SameProcessNoCandidateHandoffV1,
} from '../../src/services/recommendation/ope/inference/qualification/v7/handoff';
import {
  evaluateSyntheticCohortOpeV4,
  isVerifiedOpeAggregateReceiptV4,
} from '../../src/services/recommendation/ope/v4';

describe('Phase 17 cohort OPE trust boundaries', () => {
  it('rejects plain and hostile inputs without escaping exceptions', async () => {
    const hostile = new Proxy({}, {
      get: () => { throw new Error('hostile getter'); },
      ownKeys: () => { throw new Error('hostile ownKeys'); },
    });
    await expect(verifySyntheticCohortTrajectoryEvidenceV1(hostile)).resolves.toEqual({
      status: 'not_evaluable',
      blocker: 'synthetic_cohort_trajectory_source_unverified',
    });
    await expect(evaluateSyntheticCohortOpeV4(hostile)).resolves.toEqual({
      status: 'not_evaluable',
      blocker: 'ope_v4_source_unverified',
    });
    expect(() => buildPhase17SyntheticViewerClusterMappingAuditV1(hostile)).not.toThrow();
    expect(buildPhase17SyntheticViewerClusterMappingAuditV1(hostile)).toEqual({
      status: 'not_evaluable',
      blocker: 'phase17_mapping_source_unverified',
    });
    expect(() => buildPhase17SameProcessNoCandidateHandoffV1(hostile)).not.toThrow();
    expect(buildPhase17SameProcessNoCandidateHandoffV1(hostile)).toEqual({
      status: 'not_evaluable',
      blocker: 'phase17_handoff_source_unverified',
    });
    for (const guard of [
      isVerifiedSyntheticCohortTrajectoryEvidenceV1,
      isVerifiedOpeAggregateReceiptV4,
      isVerifiedPhase17SyntheticViewerClusterMappingAuditV1,
      isVerifiedPhase17SameProcessNoCandidateHandoffV1,
    ]) {
      expect(() => guard(hostile)).not.toThrow();
      expect(guard(hostile)).toBe(false);
      expect(guard({})).toBe(false);
    }
  });
});
