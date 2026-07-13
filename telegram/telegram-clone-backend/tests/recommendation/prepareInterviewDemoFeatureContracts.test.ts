import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEMO_CLUSTER_ORDER } from '../../src/scripts/demo/config';
import type { DemoClusterKey, DemoUserSeed } from '../../src/scripts/demo/contracts';
import type { EmbeddingContract } from '../../src/services/recommendation/contracts/embeddingContract';
import { isCompleteEmbeddingContract } from '../../src/services/recommendation/contracts/embeddingContractEvidence';
import { isVectorCompatibleWithContract } from '../../src/services/recommendation/contracts/embeddingContract';

const runtimeMocks = vi.hoisted(() => ({
    connectDemoStores: vi.fn(),
    disconnectDemoStores: vi.fn(),
}));

vi.mock('../../src/scripts/demo/runtime', () => ({
    buildFrontendTargetWarnings: vi.fn(() => []),
    connectDemoStores: runtimeMocks.connectDemoStores,
    disconnectDemoStores: runtimeMocks.disconnectDemoStores,
    resolvePublicApiBaseUrl: vi.fn(() => null),
}));

describe('prepareInterviewDemo user feature documents', () => {
    const originalViewerPassword = process.env.DEMO_VIEWER_PASSWORD;

    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.DEMO_VIEWER_PASSWORD;
    });

    afterEach(() => {
        if (originalViewerPassword === undefined) {
            delete process.env.DEMO_VIEWER_PASSWORD;
        } else {
            process.env.DEMO_VIEWER_PASSWORD = originalViewerPassword;
        }
        vi.restoreAllMocks();
    });

    it('does not execute the CLI main or connect stores when imported', async () => {
        const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        await import('../../src/scripts/demo/prepareInterviewDemo');
        await Promise.resolve();
        await Promise.resolve();

        expect(runtimeMocks.connectDemoStores).not.toHaveBeenCalled();
        expect(runtimeMocks.disconnectDemoStores).not.toHaveBeenCalled();
        expect(exit).not.toHaveBeenCalled();
    });

    it('builds demo-local contracts for every Two-Tower and Phoenix vector', async () => {
        const demoModule = await import('../../src/scripts/demo/prepareInterviewDemo') as unknown as {
            buildUserFeatureDocuments?: (input: {
                viewer: DemoUserSeed;
                authorsByCluster: Record<DemoClusterKey, DemoUserSeed[]>;
                bridges: DemoUserSeed[];
            }) => DemoUserFeatureDocument[];
        };
        expect(demoModule.buildUserFeatureDocuments).toBeTypeOf('function');

        const authorsByCluster = Object.fromEntries(DEMO_CLUSTER_ORDER.map((cluster) => [
            cluster,
            [demoUser(`author-${cluster}`, cluster)],
        ])) as Record<DemoClusterKey, DemoUserSeed[]>;
        const docs = demoModule.buildUserFeatureDocuments!({
            viewer: demoUser('viewer'),
            authorsByCluster,
            bridges: [demoUser('bridge', 'recsys', ['ai'])],
        });

        expect(docs.length).toBeGreaterThan(0);
        for (const doc of docs) {
            expect(doc.twoTowerEmbedding).toHaveLength(16);
            expect(isCompleteEmbeddingContract(doc.twoTowerEmbeddingContract)).toBe(true);
            expect(isVectorCompatibleWithContract(
                doc.twoTowerEmbedding,
                doc.twoTowerEmbeddingContract,
            )).toBe(true);
            expect(doc.twoTowerEmbeddingContract).toMatchObject({
                embeddingSpace: 'interview_demo_two_tower_seed_v1',
                dimensions: 16,
                retrievalEmbeddingDim: 16,
                rankingEmbeddingDim: 16,
                modelVersion: 'interview_demo_two_tower_seed_v1',
                artifactVersion: 'prepare_interview_demo_two_tower_seed_v1',
                producer: 'prepareInterviewDemo.buildUserFeatureDocuments',
                semantic: false,
            });

            expect(doc.phoenixEmbedding).toHaveLength(24);
            expect(isCompleteEmbeddingContract(doc.phoenixEmbeddingContract)).toBe(true);
            expect(isVectorCompatibleWithContract(
                doc.phoenixEmbedding,
                doc.phoenixEmbeddingContract,
            )).toBe(true);
            expect(doc.phoenixEmbeddingContract).toMatchObject({
                embeddingSpace: 'interview_demo_phoenix_seed_v1',
                dimensions: 24,
                retrievalEmbeddingDim: 24,
                rankingEmbeddingDim: 24,
                modelVersion: 'interview_demo_phoenix_seed_v1',
                artifactVersion: 'prepare_interview_demo_phoenix_seed_v1',
                producer: 'prepareInterviewDemo.buildUserFeatureDocuments',
                semantic: false,
            });
            expect(doc.twoTowerEmbeddingContract).not.toBe(doc.phoenixEmbeddingContract);
            expect(doc).not.toHaveProperty('embeddingContract');
        }
    });
});

type DemoUserFeatureDocument = {
    twoTowerEmbedding: number[];
    twoTowerEmbeddingContract?: EmbeddingContract;
    phoenixEmbedding: number[];
    phoenixEmbeddingContract?: EmbeddingContract;
    embeddingContract?: EmbeddingContract;
};

function demoUser(
    id: string,
    cluster?: DemoClusterKey,
    secondaryClusters: DemoClusterKey[] = [],
): DemoUserSeed {
    return {
        id,
        username: id,
        displayName: id,
        role: cluster ? 'author' : 'viewer',
        passwordHash: 'hash',
        avatarUrl: 'https://example.com/avatar.png',
        cluster,
        secondaryClusters,
        bio: 'demo',
        location: 'demo',
        website: 'https://example.com',
        isOnline: false,
        lastSeen: new Date('2026-07-13T00:00:00.000Z'),
    };
}
