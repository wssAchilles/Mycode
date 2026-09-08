import type { RecommendationDecisionLogV1 } from '../../decisionLog/contracts';
import type {
  TargetDistributionManifestV1,
  TargetDistributionStreamVerificationReceiptV2,
} from '../contracts/targetDistribution';

export type ByteStreamFactoryV2 = () => AsyncIterable<string | Uint8Array>;

export type TargetDistributionStreamVerificationInputV2 = {
  trustScope: 'synthetic_fixture' | 'production';
  sourceDecisionStream: ByteStreamFactoryV2;
  distributionStream: ByteStreamFactoryV2;
  sourceDatasetManifestRaw: string;
  policyConfigRaw: string;
  targetManifestRaw: string;
  verificationReceiptRaw: string;
};

export type VerifiedTargetDistributionStepV2 = {
  servedPosition: number;
  prefixActionKeys: RecommendationDecisionLogV1['actions'][number]['actionKey'][];
  actions: Array<{
    actionKey: RecommendationDecisionLogV1['actions'][number]['actionKey'];
    deterministicTop: boolean;
    plackettLuceProbability: number;
    conditionalSelectionProbability: number;
  }>;
};

export type VerifiedTargetDistributionDecisionV2 = {
  source: RecommendationDecisionLogV1;
  decisionLogSha256: string;
  candidatePoolSha256: string;
};

export type TargetDistributionReplayVisitorV2 = {
  onDecisionStart?: (
    decision: VerifiedTargetDistributionDecisionV2,
  ) => Promise<void> | void;
  onStep?: (
    decision: VerifiedTargetDistributionDecisionV2,
    step: VerifiedTargetDistributionStepV2,
  ) => Promise<void> | void;
  onDecisionEnd?: (
    decision: VerifiedTargetDistributionDecisionV2,
  ) => Promise<void> | void;
  commit: () => Promise<void> | void;
  abort: (blocker: string) => Promise<void> | void;
};

export type VerifiedTargetDistributionEvidenceV2 = {
  contractVersion: 'verified_target_distribution_evidence_v2';
  trustScope: 'synthetic_fixture';
  manifest: TargetDistributionManifestV1;
  receipt: TargetDistributionStreamVerificationReceiptV2;
  sourceDatasetManifestSha256: string;
  targetManifestSha256: string;
  verificationReceiptRawSha256: string;
  realDatasetEligible: false;
  servable: false;
};

export type TargetDistributionContractValidationV2 = {
  contractVersion: 'target_distribution_contract_validation_v2';
  receiptSha256: string;
  sourceDecisionNdjsonSha256: string;
  distributionNdjsonSha256: string;
  decisionCount: number;
  stepCount: number;
  actionProbabilityCount: number;
  physicalRecordCount: number;
  realDatasetEligible: false;
  servable: false;
};

export type VerifyTargetDistributionStreamResultV2 =
  | { status: 'verified'; evidence: VerifiedTargetDistributionEvidenceV2 }
  | {
    status: 'contract_validated';
    blocker: 'rust_verification_trust_root_unavailable';
    validation: TargetDistributionContractValidationV2;
  }
  | { status: 'not_evaluable'; blocker: string };
