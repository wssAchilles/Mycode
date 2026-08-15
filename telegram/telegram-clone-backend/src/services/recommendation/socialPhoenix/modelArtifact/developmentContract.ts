import type { SocialPhoenixLinearModel, SocialPhoenixTask } from '../types';

const SOCIAL_PHOENIX_TASKS: SocialPhoenixTask[] = [
    'click',
    'like',
    'reply',
    'repost',
    'quote',
    'share',
    'engagement',
    'negative',
];

export const SOCIAL_PHOENIX_DEVELOPMENT_MODEL_LIMITS = Object.freeze({
    maximumArtifactBytes: 8 * 1024 * 1024,
    maximumFeatures: 4_096,
    maximumFeatureNameUtf8Bytes: 128,
});

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isValidSocialPhoenixDevelopmentModelV1(
    value: unknown,
): value is SocialPhoenixLinearModel {
    if (!isRecord(value) || value.version !== 1 || typeof value.trainedAt !== 'string') return false;
    const trainedAtMs = Date.parse(value.trainedAt);
    if (!Number.isFinite(trainedAtMs) || new Date(trainedAtMs).toISOString() !== value.trainedAt) return false;
    if (
        !Array.isArray(value.features)
        || value.features.length > SOCIAL_PHOENIX_DEVELOPMENT_MODEL_LIMITS.maximumFeatures
    ) return false;
    if (!isRecord(value.tasks)) return false;

    const features = value.features;
    const featureSet = new Set<string>();
    for (const feature of features) {
        if (
            typeof feature !== 'string'
            || feature.length === 0
            || Buffer.byteLength(feature, 'utf8')
                > SOCIAL_PHOENIX_DEVELOPMENT_MODEL_LIMITS.maximumFeatureNameUtf8Bytes
            || featureSet.has(feature)
        ) return false;
        featureSet.add(feature);
    }
    if (features.some((feature, index) => index > 0 && features[index - 1] > feature)) return false;

    const taskKeys = Object.keys(value.tasks).sort();
    if (taskKeys.join('\0') !== SOCIAL_PHOENIX_TASKS.slice().sort().join('\0')) return false;
    for (const task of SOCIAL_PHOENIX_TASKS) {
        const taskModel = value.tasks[task];
        if (!isRecord(taskModel) || typeof taskModel.bias !== 'number' || !Number.isFinite(taskModel.bias)) {
            return false;
        }
        const weights = taskModel.weights;
        if (!isRecord(weights)) return false;
        const weightKeys = Object.keys(weights);
        if (weightKeys.length !== featureSet.size || weightKeys.some((feature) => !featureSet.has(feature))) {
            return false;
        }
        if (weightKeys.some((feature) => (
            typeof weights[feature] !== 'number'
            || !Number.isFinite(weights[feature])
        ))) return false;
    }
    return true;
}
