import { readFile } from 'fs/promises';

export interface RecommendationRolloutPolicy {
  version: string;
  windowHours: number;
  minimumPrimarySamples: number;
  maximumFallbackRatio: number;
}

export interface RecommendationRolloutPolicyConfig {
  activeVersion: string;
  approvedVersions: readonly string[];
  policies: Record<string, Omit<RecommendationRolloutPolicy, 'version'>>;
}

export type RecommendationRolloutPolicyLoadResult =
  | { ok: true; policy: RecommendationRolloutPolicy }
  | { ok: false; blocker: string };

export function loadRecommendationRolloutPolicy(
  config: unknown,
): RecommendationRolloutPolicyLoadResult {
  if (config === undefined || config === null) {
    return { ok: false, blocker: 'recommendation_rollout_policy_missing' };
  }
  if (!isRecord(config)) {
    return { ok: false, blocker: 'recommendation_rollout_policy_invalid' };
  }

  const activeVersion = config.activeVersion;
  const approvedVersions = config.approvedVersions;
  const policies = config.policies;
  if (
    typeof activeVersion !== 'string'
    || !activeVersion.trim()
    || !Array.isArray(approvedVersions)
    || !approvedVersions.every((version) => typeof version === 'string' && Boolean(version.trim()))
    || !isRecord(policies)
  ) {
    return { ok: false, blocker: 'recommendation_rollout_policy_invalid' };
  }

  const rawPolicy = policies[activeVersion];
  if (rawPolicy === undefined) {
    return { ok: false, blocker: 'recommendation_rollout_policy_unknown' };
  }
  if (!isValidPolicy(rawPolicy)) {
    return { ok: false, blocker: 'recommendation_rollout_policy_invalid' };
  }
  if (!approvedVersions.includes(activeVersion)) {
    return { ok: false, blocker: 'recommendation_rollout_policy_unapproved' };
  }

  return {
    ok: true,
    policy: {
      version: activeVersion,
      windowHours: rawPolicy.windowHours,
      minimumPrimarySamples: rawPolicy.minimumPrimarySamples,
      maximumFallbackRatio: rawPolicy.maximumFallbackRatio,
    },
  };
}

export async function loadRecommendationRolloutPolicyFile(): Promise<RecommendationRolloutPolicyLoadResult> {
  const file = process.env.RECOMMENDATION_ROLLOUT_POLICY_FILE?.trim();
  if (!file) {
    return { ok: false, blocker: 'recommendation_rollout_policy_missing' };
  }

  try {
    return loadRecommendationRolloutPolicy(JSON.parse(await readFile(file, 'utf8')));
  } catch {
    return { ok: false, blocker: 'recommendation_rollout_policy_invalid' };
  }
}

function isValidPolicy(value: unknown): value is Omit<RecommendationRolloutPolicy, 'version'> {
  return isRecord(value)
    && isPositiveInteger(value.windowHours)
    && isPositiveInteger(value.minimumPrimarySamples)
    && typeof value.maximumFallbackRatio === 'number'
    && Number.isFinite(value.maximumFallbackRatio)
    && value.maximumFallbackRatio >= 0
    && value.maximumFallbackRatio <= 1;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
