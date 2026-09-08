import { z } from 'zod';

export const FROZEN_EVALUATION_FAMILY_V1 = 'frozen_evaluation_family_v1' as const;
export const HOLDOUT_USE_LEDGER_V1 = 'holdout_use_ledger_v1' as const;
export const HOLDOUT_USE_LEDGER_MANIFEST_V1 = 'holdout_use_ledger_manifest_v1' as const;
export const HOLDOUT_USE_LEDGER_RECEIPT_V1 = 'holdout_use_ledger_receipt_v1' as const;
export const INTERSECTION_UNION_ALL_MUST_PASS_V1 = 'intersection_union_all_must_pass_v1' as const;
export const SLOT_MEAN_ESTIMAND_V1 = 'mean_reward_per_logged_slot_v1' as const;
export const MULTIPLICITY_BLOCKER = 'multiplicity_control_unavailable' as const;

export const HOLDOUT_LEDGER_LIMITS_V1 = Object.freeze({
  maximumLineBytes: 64 * 1024,
  maximumFileBytes: 16 * 1024 * 1024,
  maximumRecords: 4_098,
  maximumMembershipEntries: 4_096,
  maximumEstimatedMembershipBytes: 1024 * 1024,
} as const);

const text = z.string().min(1).max(256).refine((value) => value.trim() === value, {
  message: 'text_not_canonical',
});
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const finite = z.number().finite();
const canonicalTimestamp = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
  }, { message: 'timestamp_not_canonical' });

const digestBindingSchema = z.object({
  bindingId: text,
  sha256,
}).strict();

export const frozenEvaluationFamilyV1Schema = z.object({
  contractVersion: z.literal(FROZEN_EVALUATION_FAMILY_V1),
  familyId: text,
  candidatePolicies: z.array(z.object({
    policyId: text,
    policyVersion: text,
    policyConfigSha256: sha256,
  }).strict()).min(1).max(64),
  objectives: z.array(z.object({
    objective: text,
    estimator: z.enum(['ips', 'clippedIps', 'snips', 'dr']),
    operator: z.enum(['gte', 'lte']),
    threshold: finite,
  }).strict()).min(1).max(64),
  segments: z.array(z.object({
    segmentKey: text,
    segmentValue: text,
    contextSourceVersion: text,
    contextSourceSha256: sha256,
    pitBoundary: z.literal('context_at_lte_available_at_lte_decision_at_v1'),
  }).strict()).max(256),
  estimand: z.literal(SLOT_MEAN_ESTIMAND_V1),
  dataset: z.object({ datasetId: text, datasetSha256: sha256 }).strict(),
  holdout: z.object({ holdoutId: text, holdoutSha256: sha256 }).strict(),
  seedMaterial: z.string().min(16).max(512),
  evidenceBindings: z.array(digestBindingSchema).min(1).max(64),
  configBindings: z.array(digestBindingSchema).min(1).max(64),
  frozenAt: canonicalTimestamp,
  holdoutRevealNotBefore: canonicalTimestamp,
  multiplicityProcedure: z.literal(INTERSECTION_UNION_ALL_MUST_PASS_V1),
  realDatasetEligible: z.literal(false),
  familySha256: sha256,
}).strict();

const ledgerStartV1Schema = z.object({
  recordType: z.literal('ledger_start'),
  contractVersion: z.literal(HOLDOUT_USE_LEDGER_V1),
  ledgerId: text,
  familySha256: sha256,
  holdoutSha256: sha256,
  initialRoot: sha256,
  expectedUseCount: z.number().int().min(0).max(HOLDOUT_LEDGER_LIMITS_V1.maximumMembershipEntries),
  realDatasetEligible: z.literal(false),
}).strict();

const holdoutUseV1Schema = z.object({
  recordType: z.literal('holdout_use'),
  contractVersion: z.literal(HOLDOUT_USE_LEDGER_V1),
  sequence: z.number().int().positive().max(HOLDOUT_LEDGER_LIMITS_V1.maximumMembershipEntries),
  useId: text,
  familySha256: sha256,
  holdoutSha256: sha256,
  purpose: z.literal('offline_policy_evaluation_v1'),
  revealedAt: canonicalTimestamp,
  usedAt: canonicalTimestamp,
  priorChainHead: sha256,
  recordSha256: sha256,
}).strict();

const ledgerEndV1Schema = z.object({
  recordType: z.literal('ledger_end'),
  contractVersion: z.literal(HOLDOUT_USE_LEDGER_V1),
  ledgerId: text,
  actualUseCount: z.number().int().min(0).max(HOLDOUT_LEDGER_LIMITS_V1.maximumMembershipEntries),
  finalChainHead: sha256,
}).strict();

export const holdoutUseLedgerRecordV1Schema = z.discriminatedUnion('recordType', [
  ledgerStartV1Schema,
  holdoutUseV1Schema,
  ledgerEndV1Schema,
]);

export const holdoutUseLedgerManifestV1Schema = z.object({
  contractVersion: z.literal(HOLDOUT_USE_LEDGER_MANIFEST_V1),
  ledgerId: text,
  familySha256: sha256,
  holdoutSha256: sha256,
  rawSha256: sha256,
  recordCount: z.number().int().min(2).max(HOLDOUT_LEDGER_LIMITS_V1.maximumRecords),
  useCount: z.number().int().min(0).max(HOLDOUT_LEDGER_LIMITS_V1.maximumMembershipEntries),
  initialRoot: sha256,
  finalChainHead: sha256,
  realDatasetEligible: z.literal(false),
  manifestSha256: sha256,
}).strict();

export const holdoutUseLedgerReceiptV1Schema = z.object({
  contractVersion: z.literal(HOLDOUT_USE_LEDGER_RECEIPT_V1),
  trustScope: z.literal('synthetic_fixture'),
  familySha256: sha256,
  holdoutSha256: sha256,
  rawSha256: sha256,
  recordCount: z.number().int().min(2).max(HOLDOUT_LEDGER_LIMITS_V1.maximumRecords),
  initialRoot: sha256,
  finalChainHead: sha256,
  manifestSha256: sha256,
  trustedRootSha256: sha256,
  diagnostics: z.object({
    totalBytes: z.number().int().nonnegative().max(HOLDOUT_LEDGER_LIMITS_V1.maximumFileBytes),
    maximumLineBytes: z.number().int().nonnegative().max(HOLDOUT_LEDGER_LIMITS_V1.maximumLineBytes),
    highWaterUseIdCount: z.number().int().nonnegative().max(HOLDOUT_LEDGER_LIMITS_V1.maximumMembershipEntries),
    highWaterHoldoutCount: z.number().int().nonnegative().max(HOLDOUT_LEDGER_LIMITS_V1.maximumMembershipEntries),
    estimatedMembershipBytes: z.number().int().nonnegative().max(HOLDOUT_LEDGER_LIMITS_V1.maximumEstimatedMembershipBytes),
    configuredMembershipCountLimit: z.literal(HOLDOUT_LEDGER_LIMITS_V1.maximumMembershipEntries),
    configuredMembershipByteLimit: z.literal(HOLDOUT_LEDGER_LIMITS_V1.maximumEstimatedMembershipBytes),
  }).strict(),
  blockers: z.tuple([z.literal(MULTIPLICITY_BLOCKER)]),
  realDatasetEligible: z.literal(false),
  receiptSha256: sha256,
}).strict();

export type FrozenEvaluationFamilyV1 = z.infer<typeof frozenEvaluationFamilyV1Schema>;
export type HoldoutUseLedgerRecordV1 = z.infer<typeof holdoutUseLedgerRecordV1Schema>;
export type HoldoutUseLedgerManifestV1 = z.infer<typeof holdoutUseLedgerManifestV1Schema>;
export type HoldoutUseLedgerReceiptDataV1 = z.infer<typeof holdoutUseLedgerReceiptV1Schema>;

export type HoldoutLedgerBlockerV1 =
  | typeof MULTIPLICITY_BLOCKER
  | 'frozen_evaluation_family_unverified'
  | 'holdout_ledger_completeness_unverified'
  | 'holdout_ledger_contract_invalid'
  | 'holdout_ledger_canonical_wire_mismatch'
  | 'holdout_ledger_stream_grammar_mismatch'
  | 'holdout_ledger_chain_mismatch'
  | 'holdout_ledger_time_boundary_mismatch'
  | 'holdout_ledger_family_mismatch'
  | 'holdout_ledger_holdout_mismatch'
  | 'holdout_ledger_digest_mismatch'
  | 'holdout_ledger_count_mismatch'
  | 'holdout_use_conflict'
  | 'holdout_already_used'
  | 'holdout_ledger_stream_error'
  | 'resource_limit_exceeded';
