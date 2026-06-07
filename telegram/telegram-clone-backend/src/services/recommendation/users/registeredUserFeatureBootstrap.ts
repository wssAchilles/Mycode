import crypto from 'crypto';

import User from '../../../models/User';
import UserFeatureVector from '../../../models/UserFeatureVector';

const COLD_START_DIM = 24;
const MODEL_VERSION = 'registered_user_cold_start_v1';
const ARTIFACT_VERSION = 'registered_user_profile_features_v1';

export interface RegisteredUserFeatureBootstrapResult {
    scanned: number;
    existing: number;
    created: number;
    dryRun: boolean;
}

export class RegisteredUserFeatureBootstrapService {
    async ensureUser(user: Pick<User, 'id' | 'username' | 'region' | 'language' | 'createdAt'>): Promise<void> {
        const existing = await UserFeatureVector.findOne({ userId: user.id }).select('_id').lean();
        if (existing) return;
        await UserFeatureVector.create(this.buildVector(user));
    }

    async backfill(options: {
        dryRun?: boolean;
        limit?: number;
        batchSize?: number;
    } = {}): Promise<RegisteredUserFeatureBootstrapResult> {
        const limit = Math.max(1, Math.min(options.limit ?? 10000, 100000));
        const batchSize = Math.max(1, Math.min(options.batchSize ?? 500, 2000));
        const dryRun = options.dryRun === true;
        let scanned = 0;
        let existing = 0;
        let created = 0;
        let offset = 0;

        while (scanned < limit) {
            const users = await User.findAll({
                order: [['createdAt', 'DESC']],
                offset,
                limit: Math.min(batchSize, limit - scanned),
            });
            if (users.length === 0) break;

            scanned += users.length;
            offset += users.length;

            const userIds = users.map((user) => user.id);
            const existingDocs = await UserFeatureVector.find({ userId: { $in: userIds } })
                .select('userId')
                .lean();
            const existingIds = new Set(existingDocs.map((doc) => doc.userId));
            existing += existingIds.size;

            const missing = users.filter((user) => !existingIds.has(user.id));
            if (dryRun) {
                created += missing.length;
                continue;
            }

            if (missing.length > 0) {
                await UserFeatureVector.insertMany(
                    missing.map((user) => this.buildVector(user)),
                    { ordered: false },
                );
                created += missing.length;
            }
        }

        return { scanned, existing, created, dryRun };
    }

    private buildVector(user: Pick<User, 'id' | 'username' | 'region' | 'language' | 'createdAt'>) {
        const vector = deterministicDenseVector([
            user.id,
            user.username,
            user.region || '',
            user.language || '',
        ]);
        const knownForCluster = deterministicClusterId(user.region || user.language || user.id);
        const now = new Date();
        return {
            userId: user.id,
            interestedInClusters: [
                { clusterId: deterministicClusterId(user.language || 'language_unknown'), score: 0.55 },
                { clusterId: deterministicClusterId(user.region || 'region_unknown'), score: 0.45 },
            ],
            knownForCluster,
            knownForScore: 0.1,
            producerEmbedding: [{ clusterId: knownForCluster, score: 0.1 }],
            twoTowerEmbedding: vector,
            phoenixEmbedding: vector,
            version: 1,
            modelVersion: MODEL_VERSION,
            artifactVersion: ARTIFACT_VERSION,
            modelProfile: 'cold_start_registered_user',
            embeddingDim: COLD_START_DIM,
            embeddingContract: {
                embeddingSpace: `user_dense_dim_${COLD_START_DIM}`,
                retrievalEmbeddingDim: COLD_START_DIM,
                rankingEmbeddingDim: COLD_START_DIM,
                modelVersion: MODEL_VERSION,
                artifactVersion: ARTIFACT_VERSION,
                producer: 'RegisteredUserFeatureBootstrapService',
            },
            computedAt: now,
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            qualityScore: 0.05,
        };
    }
}

function deterministicDenseVector(parts: string[]): number[] {
    const values: number[] = [];
    let seed = parts.join('|');
    while (values.length < COLD_START_DIM) {
        const hash = crypto.createHash('sha256').update(seed).digest();
        for (const byte of hash) {
            values.push((byte / 255) * 2 - 1);
            if (values.length >= COLD_START_DIM) break;
        }
        seed = hash.toString('hex');
    }
    const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1;
    return values.map((value) => Number((value / norm).toFixed(8)));
}

function deterministicClusterId(value: string): number {
    const digest = crypto.createHash('sha1').update(value || 'unknown').digest();
    return 10_000 + digest.readUInt16BE(0);
}

export const registeredUserFeatureBootstrapService = new RegisteredUserFeatureBootstrapService();
