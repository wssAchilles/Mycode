import { normalizeRecommendationActionIdentity } from './actionIdentity';

export const SERVED_POSITION_CONTRACT_VERSION = 'served_position_1_based_v1' as const;

export function normalizeServedPosition(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
        ? value
        : undefined;
}

export function normalizeAnalyticsPositionMetadata(metadata: unknown): Record<string, unknown> & {
    servedPosition?: number;
    positionContractVersion?: typeof SERVED_POSITION_CONTRACT_VERSION;
} {
    const source = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? metadata as Record<string, unknown>
        : {};
    const normalized = { ...source };
    const position = source.position;
    delete normalized.position;
    delete normalized.servedPosition;
    delete normalized.positionContractVersion;
    delete normalized.decisionId;
    delete normalized.candidateNamespace;
    delete normalized.candidateId;
    const actionIdentity = normalizeRecommendationActionIdentity(source);

    const servedPosition = typeof position === 'number'
        && Number.isSafeInteger(position)
        && position >= 0
        && position < Number.MAX_SAFE_INTEGER
        ? position + 1
        : undefined;

    if (servedPosition === undefined) return { ...normalized, ...actionIdentity };
    return {
        ...normalized,
        ...actionIdentity,
        servedPosition,
        positionContractVersion: SERVED_POSITION_CONTRACT_VERSION,
    };
}
