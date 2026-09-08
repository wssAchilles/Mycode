import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    connectMongoDB: vi.fn(),
}));

vi.mock('../../src/config/db', () => ({
    connectMongoDB: mocks.connectMongoDB,
}));

import {
    connectRecommendationAuditMongo,
    type RecommendationAuditMongoAccessError,
    validateRecommendationAuditEvidence,
} from '../../src/services/ops/recommendation/auditMongoAccess';

const URI = 'mongodb://audit-reader:secret@localhost:27017/telegram';
const NOW = new Date('2026-07-13T00:00:00.000Z');

describe('validateRecommendationAuditEvidence', () => {
    it('validates exact read-only evidence without connecting', () => {
        const evidence = validateRecommendationAuditEvidence(evidenceRaw(), NOW);

        expect(evidence).toMatchObject({
            schemaVersion: 1,
            reviewedBy: 'release-operator',
            role: 'read',
            database: 'telegram',
        });
        expect(mocks.connectMongoDB).not.toHaveBeenCalled();
    });

    it.each([
        ['invalid schema', { extraClaim: true }, 'recommendation_audit_evidence_invalid'],
        ['wrong role', { role: 'readWrite' }, 'recommendation_audit_role_not_allowed'],
        ['expired', { expiresAt: '2026-07-12T23:59:59.999Z' }, 'recommendation_audit_evidence_expired'],
    ])('rejects %s', (_name, overrides, code) => {
        const error = captureError(() => validateRecommendationAuditEvidence(evidenceRaw(overrides), NOW));

        expect(error.code).toBe(code);
        expect(mocks.connectMongoDB).not.toHaveBeenCalled();
    });
});

describe('connectRecommendationAuditMongo', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(path.join(os.tmpdir(), 'recommendation-audit-'));
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
        delete process.env.RECOMMENDATION_AUDIT_MONGODB_URI;
        delete process.env.RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE;
        process.env.MONGODB_URI = 'mongodb://must-not-be-used/fallback';
        mocks.connectMongoDB.mockResolvedValue(undefined);
    });

    afterEach(async () => {
        vi.useRealTimers();
        vi.clearAllMocks();
        delete process.env.RECOMMENDATION_AUDIT_MONGODB_URI;
        delete process.env.RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE;
        delete process.env.MONGODB_URI;
        await rm(tempDir, { recursive: true, force: true });
    });

    it.each([
        {
            name: 'missing dedicated URI',
            prepare: async () => {
                process.env.RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE = await writeEvidence(tempDir);
            },
            code: 'recommendation_audit_uri_missing',
        },
        {
            name: 'missing evidence file setting',
            prepare: async () => {
                process.env.RECOMMENDATION_AUDIT_MONGODB_URI = URI;
            },
            code: 'recommendation_audit_evidence_file_missing',
        },
        {
            name: 'invalid JSON',
            prepare: async () => {
                process.env.RECOMMENDATION_AUDIT_MONGODB_URI = URI;
                const file = path.join(tempDir, 'invalid.json');
                await writeFile(file, '{not-json', 'utf8');
                process.env.RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE = file;
            },
            code: 'recommendation_audit_evidence_invalid',
        },
        {
            name: 'invalid exact schema',
            prepare: async () => {
                process.env.RECOMMENDATION_AUDIT_MONGODB_URI = URI;
                process.env.RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE = await writeEvidence(tempDir, {
                    extraClaim: 'server_role_verified',
                });
            },
            code: 'recommendation_audit_evidence_invalid',
        },
        {
            name: 'expired review',
            prepare: async () => {
                process.env.RECOMMENDATION_AUDIT_MONGODB_URI = URI;
                process.env.RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE = await writeEvidence(tempDir, {
                    expiresAt: '2026-07-12T23:59:59.999Z',
                });
            },
            code: 'recommendation_audit_evidence_expired',
        },
        {
            name: 'URI digest mismatch',
            prepare: async () => {
                process.env.RECOMMENDATION_AUDIT_MONGODB_URI = URI;
                process.env.RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE = await writeEvidence(tempDir, {
                    mongodbUriSha256: crypto.createHash('sha256').update('different-uri').digest('hex'),
                });
            },
            code: 'recommendation_audit_uri_digest_mismatch',
        },
    ])('fails before connect for $name', async ({ prepare, code }) => {
        await prepare();

        const error = await connectRecommendationAuditMongo().catch((caught) => caught) as RecommendationAuditMongoAccessError;

        expect(error).toBeInstanceOf(Error);
        expect(error.code).toBe(code);
        expect(error.message).toMatch(new RegExp(`^${code}:`));
        expect(mocks.connectMongoDB).not.toHaveBeenCalled();
    });

    it.each([null, 7, 'readWrite', 'READ', ''])('maps role %j to the stable role error', async (role) => {
        process.env.RECOMMENDATION_AUDIT_MONGODB_URI = URI;
        process.env.RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE = await writeEvidence(tempDir, { role });

        const error = await connectRecommendationAuditMongo().catch((caught) => caught) as RecommendationAuditMongoAccessError;

        expect(error.code).toBe('recommendation_audit_role_not_allowed');
        expect(error.message).toMatch(/^recommendation_audit_role_not_allowed:/);
        expect(mocks.connectMongoDB).not.toHaveBeenCalled();
    });

    it('connects with index and collection creation disabled after valid operator evidence', async () => {
        process.env.RECOMMENDATION_AUDIT_MONGODB_URI = URI;
        const evidenceFile = await writeEvidence(tempDir);
        process.env.RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE = evidenceFile;
        const raw = await import('fs/promises').then(({ readFile }) => readFile(evidenceFile));

        const result = await connectRecommendationAuditMongo();

        expect(mocks.connectMongoDB).toHaveBeenCalledWith({
            uri: URI,
            autoIndex: false,
            autoCreate: false,
            quiet: true,
        });
        expect(result).toEqual({
            evidenceFile,
            evidenceFileSha256: crypto.createHash('sha256').update(raw).digest('hex'),
        });
    });
});

async function writeEvidence(
    tempDir: string,
    overrides: Record<string, unknown> = {},
): Promise<string> {
    const file = path.join(tempDir, `evidence-${crypto.randomUUID()}.json`);
    await writeFile(file, evidenceRaw(overrides), 'utf8');
    return file;
}

function evidenceRaw(overrides: Record<string, unknown> = {}): Buffer {
    return Buffer.from(JSON.stringify({
        schemaVersion: 1,
        reviewedBy: 'release-operator',
        reviewedAt: '2026-07-12T00:00:00.000Z',
        expiresAt: '2026-07-14T00:00:00.000Z',
        database: 'telegram',
        role: 'read',
        mongodbUriSha256: crypto.createHash('sha256').update(URI).digest('hex'),
        ...overrides,
    }));
}

function captureError(action: () => unknown): RecommendationAuditMongoAccessError {
    try {
        action();
        throw new Error('expected validation failure');
    } catch (error) {
        return error as RecommendationAuditMongoAccessError;
    }
}
