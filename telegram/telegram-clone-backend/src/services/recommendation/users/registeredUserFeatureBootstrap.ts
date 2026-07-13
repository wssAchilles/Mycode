import crypto from 'crypto';

import User from '../../../models/User';
import UserFeatureVector from '../../../models/UserFeatureVector';
import {
    REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
    isVectorCompatibleWithContract,
    type EmbeddingContract,
} from '../contracts/embeddingContract';
import { isCompleteEmbeddingContract } from '../contracts/embeddingContractEvidence';
import { buildRegisteredUserColdStartEmbedding } from './coldStartEmbedding';

const COLD_START_DIM = REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT.retrievalEmbeddingDim;
const MODEL_VERSION = REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT.modelVersion;
const ARTIFACT_VERSION = REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT.artifactVersion;

export interface RegisteredUserFeatureBootstrapResult {
    scanned: number;
    existing: number;
    created: number;
    dryRun: boolean;
}

export interface RegisteredUserDenseRepairResult {
    scanned: number;
    repaired: number;
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

    async repairDenseVectors(
        users: Array<Pick<User, 'id' | 'username' | 'region' | 'language' | 'createdAt'>>
    ): Promise<RegisteredUserDenseRepairResult> {
        if (users.length === 0) {
            return { scanned: 0, repaired: 0 };
        }

        const userIds = users.map((user) => user.id);
        const docs = await UserFeatureVector.find({ userId: { $in: userIds } })
            .select([
                '_id',
                'userId',
                'updatedAt',
                'twoTowerEmbedding',
                'twoTowerEmbeddingContract',
                'twoTowerEmbeddingQuarantineReason',
                'phoenixEmbedding',
                'phoenixEmbeddingContract',
            ].join(' '))
            .lean();
        const docsByUserId = new Map(docs.map((doc) => [doc.userId, doc]));
        const operations = [];

        for (const user of users) {
            const doc = docsByUserId.get(user.id);
            if (!doc) continue;

            const repairTwoTower = shouldRepairColdStartSlot(
                doc.twoTowerEmbedding,
                doc.twoTowerEmbeddingContract,
                doc.twoTowerEmbeddingQuarantineReason,
            );
            const repairPhoenix = shouldRepairColdStartSlot(
                doc.phoenixEmbedding,
                doc.phoenixEmbeddingContract,
            );
            if (!repairTwoTower && !repairPhoenix) continue;

            const vector = buildRegisteredUserColdStartEmbedding(user);
            const $set: Record<string, unknown> = {};
            if (repairTwoTower) {
                $set.twoTowerEmbedding = vector;
                $set.twoTowerEmbeddingContract = { ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT };
            }
            if (repairPhoenix) {
                $set.phoenixEmbedding = vector;
                $set.phoenixEmbeddingContract = { ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT };
            }

            operations.push({
                updateOne: {
                    filter: {
                        _id: doc._id,
                        updatedAt: (doc as typeof doc & { updatedAt?: Date }).updatedAt
                            ?? { $exists: false },
                    },
                    update: { $set },
                },
            });
        }

        const result = operations.length > 0
            ? await UserFeatureVector.bulkWrite(operations, { ordered: false })
            : undefined;

        return { scanned: users.length, repaired: result?.modifiedCount ?? 0 };
    }

    private buildVector(user: Pick<User, 'id' | 'username' | 'region' | 'language' | 'createdAt'>) {
        const vector = buildRegisteredUserColdStartEmbedding(user);
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
            twoTowerEmbeddingContract: { ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT },
            phoenixEmbedding: vector,
            phoenixEmbeddingContract: { ...REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT },
            version: 1,
            modelVersion: MODEL_VERSION,
            artifactVersion: ARTIFACT_VERSION,
            modelProfile: 'cold_start_registered_user',
            embeddingDim: COLD_START_DIM,
            computedAt: now,
            expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
            qualityScore: 0.05,
        };
    }
}

function shouldRepairColdStartSlot(
    vector: unknown,
    contract?: EmbeddingContract | null,
    quarantineReason?: string | null,
): boolean {
    if (quarantineReason !== undefined && quarantineReason !== null) return false;
    const trustedColdStart = isRegisteredUserColdStartContract(contract);
    const missing = vector === undefined
        || vector === null
        || (Array.isArray(vector) && vector.length === 0);
    if (missing) return contract === undefined || contract === null || trustedColdStart;
    return trustedColdStart
        && !isVectorCompatibleWithContract(vector, REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT);
}

function isRegisteredUserColdStartContract(contract: unknown): contract is EmbeddingContract {
    if (!isCompleteEmbeddingContract(contract)) return false;
    const expected = REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT;
    return contract.embeddingSpace === expected.embeddingSpace
        && contract.dimensions === expected.dimensions
        && contract.retrievalEmbeddingDim === expected.retrievalEmbeddingDim
        && contract.rankingEmbeddingDim === expected.rankingEmbeddingDim
        && contract.modelVersion === expected.modelVersion
        && contract.artifactVersion === expected.artifactVersion
        && contract.producer === expected.producer
        && contract.semantic === expected.semantic;
}

function deterministicClusterId(value: string): number {
    const digest = crypto.createHash('sha1').update(value || 'unknown').digest();
    return 10_000 + digest.readUInt16BE(0);
}

export const registeredUserFeatureBootstrapService = new RegisteredUserFeatureBootstrapService();
