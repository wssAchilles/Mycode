import type {
    PostEngagementBucket,
    PostFeatureClusterScore,
    PostFeatureKeywordScore,
    PostFreshnessBucket,
} from '../../../models/PostFeatureSnapshot';
import type { SparseEmbeddingEntry } from '../types/FeedQuery';

const CONFIG = {
    dimensions: Math.max(
        16,
        parseInt(String(process.env.RECOMMENDATION_CONTENT_DENSE_EMBEDDING_DIMENSIONS || '48'), 10) || 48,
    ),
};

type DenseFeature = {
    key: string;
    weight: number;
};

export interface BuildDensePostEmbeddingInput {
    keywordScores?: PostFeatureKeywordScore[];
    clusterScores?: PostFeatureClusterScore[];
    authorProducerClusters?: Array<{ clusterId: number; score: number }>;
    authorKnownForCluster?: number;
    engagementBucket?: PostEngagementBucket;
    freshnessBucket?: PostFreshnessBucket;
    hasMedia?: boolean;
    mediaTypes?: string[];
    language?: string;
}

export interface BuildDenseUserEmbeddingInput {
    clusters: SparseEmbeddingEntry[];
    keywordWeights?: Map<string, number>;
    qualityScore?: number;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
}

function fnv1a(value: string, seed: number = 2166136261): number {
    let hash = seed >>> 0;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function normalizeVector(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (!Number.isFinite(norm) || norm <= 0) {
        return vector.map(() => 0);
    }
    return vector.map((value) => value / norm);
}

function buildHashedDenseVector(features: DenseFeature[], dimensions: number = CONFIG.dimensions): number[] {
    const vector = new Array<number>(dimensions).fill(0);

    for (const feature of features) {
        if (!feature.key || !Number.isFinite(feature.weight) || feature.weight <= 0) {
            continue;
        }
        const bucket = fnv1a(feature.key) % dimensions;
        const sign = (fnv1a(`${feature.key}:sign`) & 1) === 0 ? 1 : -1;
        vector[bucket] += feature.weight * sign;
    }

    return normalizeVector(vector);
}

function engagementBucketWeight(bucket?: PostEngagementBucket): number {
    switch (bucket) {
        case 'viral':
            return 0.7;
        case 'high':
            return 0.5;
        case 'medium':
            return 0.35;
        case 'low':
            return 0.2;
        default:
            return 0;
    }
}

function freshnessBucketWeight(bucket?: PostFreshnessBucket): number {
    switch (bucket) {
        case 'hours_24':
            return 0.7;
        case 'days_7':
            return 0.5;
        case 'days_30':
            return 0.35;
        case 'days_90':
            return 0.18;
        case 'stale':
            return 0.08;
        default:
            return 0;
    }
}

export function buildDensePostEmbedding(input: BuildDensePostEmbeddingInput): number[] {
    const features: DenseFeature[] = [];

    for (const entry of input.clusterScores || []) {
        features.push({
            key: `cluster:${entry.clusterId}`,
            weight: clamp01(entry.score) * 2.4,
        });
    }

    for (const entry of input.authorProducerClusters || []) {
        features.push({
            key: `author_cluster:${entry.clusterId}`,
            weight: clamp01(entry.score) * 1.5,
        });
    }

    if (typeof input.authorKnownForCluster === 'number') {
        features.push({
            key: `author_known_for:${input.authorKnownForCluster}`,
            weight: 0.6,
        });
    }

    for (const entry of input.keywordScores || []) {
        const keyword = String(entry.keyword || '').trim().toLowerCase();
        if (!keyword) continue;
        features.push({
            key: `keyword:${keyword}`,
            weight: clamp01(entry.weight) * 1.2,
        });
    }

    if (input.language) {
        features.push({
            key: `lang:${String(input.language).trim().toLowerCase()}`,
            weight: 0.35,
        });
    }

    if (input.hasMedia) {
        features.push({
            key: 'media:present',
            weight: 0.25,
        });
    }

    for (const mediaType of input.mediaTypes || []) {
        const normalized = String(mediaType || '').trim().toLowerCase();
        if (!normalized) continue;
        features.push({
            key: `media:${normalized}`,
            weight: 0.4,
        });
    }

    if (input.engagementBucket) {
        features.push({
            key: `engagement:${input.engagementBucket}`,
            weight: engagementBucketWeight(input.engagementBucket),
        });
    }

    if (input.freshnessBucket) {
        features.push({
            key: `freshness:${input.freshnessBucket}`,
            weight: freshnessBucketWeight(input.freshnessBucket),
        });
    }

    return buildHashedDenseVector(features);
}

export function buildDenseUserEmbedding(input: BuildDenseUserEmbeddingInput): number[] {
    const features: DenseFeature[] = [];

    for (const cluster of input.clusters || []) {
        features.push({
            key: `cluster:${cluster.clusterId}`,
            weight: clamp01(cluster.score) * 2.2,
        });
        features.push({
            key: `author_cluster:${cluster.clusterId}`,
            weight: clamp01(cluster.score) * 0.7,
        });
    }

    for (const [keyword, rawWeight] of input.keywordWeights || new Map<string, number>()) {
        const normalized = String(keyword || '').trim().toLowerCase();
        if (!normalized) continue;
        features.push({
            key: `keyword:${normalized}`,
            weight: clamp01(rawWeight) * 1.1,
        });
    }

    if (typeof input.qualityScore === 'number' && input.qualityScore > 0) {
        features.push({
            key: 'query:embedding_quality',
            weight: clamp01(input.qualityScore) * 0.25,
        });
    }

    return buildHashedDenseVector(features);
}

export function cosineDenseEmbedding(left?: number[], right?: number[]): number {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) {
        return 0;
    }

    const dimensions = Math.min(left.length, right.length);
    let dot = 0;
    for (let index = 0; index < dimensions; index += 1) {
        dot += (left[index] || 0) * (right[index] || 0);
    }
    return clamp01(dot);
}
