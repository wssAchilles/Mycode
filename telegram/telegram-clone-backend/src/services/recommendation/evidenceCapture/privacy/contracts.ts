import { VIEWER_CLUSTER_UNIT_VERSION } from '../../decisionContext/contracts';

export const RECOMMENDATION_VIEWER_PSEUDONYM_V1 =
  'recommendation_viewer_pseudonym_v1' as const;

export const RECOMMENDATION_VIEWER_PSEUDONYM_PURPOSE_V1 =
  'recommendation_offline_evidence_linkage_v1' as const;

export const RECOMMENDATION_VIEWER_PSEUDONYM_ALGORITHM_V1 =
  'hkdf_sha256_hmac_sha256_v1' as const;

export const RECOMMENDATION_VIEWER_PSEUDONYM_LIMITS_V1 = Object.freeze({
  version: 'recommendation_viewer_pseudonym_limits_v1',
  requiredMasterKeyBytes: 32,
  maximumViewerIdUtf8Bytes: 256,
  maximumMetadataUtf8Bytes: 64,
  maximumCanonicalOutputBytes: 4_096,
  maximumWorkUnits: 4_096,
} as const);

export type RecommendationViewerPseudonymResourceDiagnosticsV1 = Readonly<{
  preflightCompletedBeforeCryptography: true;
  masterKeyBytes: 32;
  viewerIdUtf8Bytes: number;
  publicContextBytes: number;
  hmacMessageBytes: number;
  plannedCanonicalOutputBytes: number;
  cryptographicOperations: 3;
  workUnits: number;
}>;

export type VerifiedRecommendationViewerPseudonymV1 = Readonly<{
  contractVersion: typeof RECOMMENDATION_VIEWER_PSEUDONYM_V1;
  purpose: typeof RECOMMENDATION_VIEWER_PSEUDONYM_PURPOSE_V1;
  algorithm: typeof RECOMMENDATION_VIEWER_PSEUDONYM_ALGORITHM_V1;
  clusterUnitVersion: typeof VIEWER_CLUSTER_UNIT_VERSION;
  keyVersion: string;
  captureEpochId: string;
  viewerAccountPseudonym: string;
  resourceDiagnostics: RecommendationViewerPseudonymResourceDiagnosticsV1;
  developmentEvidenceOnly: true;
  candidateEvidenceEligible: false;
  qualificationEvidenceEligible: false;
  realDatasetEligible: false;
  servable: false;
  pseudonymReceiptSha256: string;
}>;

export type RecommendationViewerPseudonymBuildBlockerV1 =
  | 'viewer_pseudonym_input_invalid'
  | 'viewer_pseudonym_key_invalid'
  | 'viewer_pseudonym_resource_limit_exceeded';

export type RecommendationViewerPseudonymBuildResultV1 =
  | Readonly<{
    status: 'verified';
    pseudonym: VerifiedRecommendationViewerPseudonymV1;
  }>
  | Readonly<{
    status: 'not_evaluable';
    blocker: RecommendationViewerPseudonymBuildBlockerV1;
  }>;
