import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import type {
    SocialPhoenixFeatureMap,
    SocialPhoenixLinearModel,
    SocialPhoenixTask,
} from './types';
import {
    SOCIAL_PHOENIX_DEVELOPMENT_MODEL_LIMITS,
    isValidSocialPhoenixDevelopmentModelV1,
} from './modelArtifact/developmentContract';

const MODEL_SHA256 = /^[0-9a-f]{64}$/;

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function sigmoid(value: number): number {
    if (value >= 0) {
        const z = Math.exp(-value);
        return 1 / (1 + z);
    }
    const z = Math.exp(value);
    return z / (1 + z);
}

export function scoreTaskProbability(
    model: SocialPhoenixLinearModel,
    task: SocialPhoenixTask,
    features: SocialPhoenixFeatureMap,
): number {
    const taskModel = model.tasks[task];
    if (!taskModel) return 0;

    let sum = taskModel.bias || 0;
    for (const [feature, value] of Object.entries(features)) {
        if (!Number.isFinite(value) || value === 0) continue;
        sum += (taskModel.weights[feature] || 0) * value;
    }
    return clamp01(sigmoid(sum));
}

function readBoundedModelBytes(modelPath: string): Buffer {
    const descriptor = fs.openSync(modelPath, 'r');
    try {
        const stat = fs.fstatSync(descriptor);
        if (
            !stat.isFile()
            || !Number.isSafeInteger(stat.size)
            || stat.size <= 0
            || stat.size > SOCIAL_PHOENIX_DEVELOPMENT_MODEL_LIMITS.maximumArtifactBytes
        ) {
            throw new Error('social_phoenix_model_resource_invalid');
        }

        const raw = Buffer.allocUnsafe(stat.size);
        let offset = 0;
        while (offset < raw.length) {
            const bytesRead = fs.readSync(descriptor, raw, offset, raw.length - offset, offset);
            if (bytesRead === 0) throw new Error('social_phoenix_model_truncated');
            offset += bytesRead;
        }
        const trailingByte = Buffer.allocUnsafe(1);
        if (fs.readSync(descriptor, trailingByte, 0, 1, offset) !== 0) {
            throw new Error('social_phoenix_model_resource_changed');
        }
        return raw;
    } finally {
        fs.closeSync(descriptor);
    }
}

export function loadSocialPhoenixDevelopmentModel(
    modelPath: string | undefined,
    expectedSha256: string | undefined,
): SocialPhoenixLinearModel | null {
    if (!modelPath) {
        return null;
    }
    if (!expectedSha256 || !MODEL_SHA256.test(expectedSha256)) {
        console.warn('[SocialPhoenixModel] expected SHA-256 missing or invalid; learned model disabled');
        return null;
    }

    const resolvedPath = path.resolve(modelPath);
    try {
        const raw = readBoundedModelBytes(resolvedPath);
        const actualSha256 = crypto.createHash('sha256').update(raw).digest('hex');
        if (actualSha256 !== expectedSha256) {
            throw new Error('social_phoenix_model_digest_mismatch');
        }
        const parsed: unknown = JSON.parse(raw.toString('utf8'));
        if (!isValidSocialPhoenixDevelopmentModelV1(parsed)) {
            throw new Error('invalid_social_phoenix_model');
        }
        return parsed;
    } catch (error) {
        console.warn('[SocialPhoenixModel] failed to load model:', error);
        return null;
    }
}
