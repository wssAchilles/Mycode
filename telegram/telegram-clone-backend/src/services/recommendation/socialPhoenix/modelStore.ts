import fs from 'fs';
import path from 'path';

import type {
    SocialPhoenixFeatureMap,
    SocialPhoenixLinearModel,
    SocialPhoenixTask,
} from './types';

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

export function loadSocialPhoenixModel(modelPath: string | undefined): SocialPhoenixLinearModel | null {
    if (!modelPath) {
        return null;
    }

    const resolvedPath = path.resolve(modelPath);
    if (!fs.existsSync(resolvedPath)) {
        console.warn(`[SocialPhoenixModel] model file not found: ${resolvedPath}`);
        return null;
    }

    try {
        const raw = fs.readFileSync(resolvedPath, 'utf8');
        const parsed = JSON.parse(raw) as SocialPhoenixLinearModel;
        if (!parsed?.tasks || !parsed?.features) {
            throw new Error('invalid_social_phoenix_model');
        }
        return parsed;
    } catch (error) {
        console.warn('[SocialPhoenixModel] failed to load model:', error);
        return null;
    }
}
