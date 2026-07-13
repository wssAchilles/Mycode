import { describe, expect, it, vi } from 'vitest';

import {
    EMBEDDING_AUDIT_EXIT_EVIDENCE_FAILURE,
    EMBEDDING_AUDIT_EXIT_PASS,
    EMBEDDING_AUDIT_EXIT_PROGRAM_FAILURE,
    parseArgs,
    resolveEmbeddingAuditExitCode,
    runEmbeddingContractAuditCli,
} from '../../src/scripts/auditEmbeddingContracts';
import type { EmbeddingEvidenceScanResult } from '../../src/services/ops/recommendation/embeddingEvidenceAudit';
import { quarantineDigestFromChecksums } from '../../src/services/recommendation/contracts/embeddingContractEvidence';

const EMPTY_QUARANTINE_DIGEST = quarantineDigestFromChecksums([]);

describe('auditEmbeddingContracts arguments', () => {
    it('rejects a limited strict audit', () => {
        expect(() => parseArgs(['--strict', '--limit', '10']))
            .toThrow('embedding_audit_limited_strict_forbidden');
    });

    it('keeps strict mode uncapped by default', () => {
        expect(parseArgs(['--strict'])).toEqual({
            strict: true,
            limit: undefined,
            diagnosticOnly: false,
            approvedQuarantineDigest: undefined,
        });
    });

    it('marks any limited audit diagnostic-only', () => {
        expect(parseArgs(['--limit', '25'])).toMatchObject({
            strict: false,
            limit: 25,
            diagnosticOnly: true,
        });
    });

    it.each([
        ['uppercase', 'A'.repeat(64)],
        ['too short', 'a'.repeat(63)],
        ['too long', 'a'.repeat(65)],
        ['non-hex', `${'a'.repeat(63)}g`],
    ])('rejects an %s approved quarantine digest', (_label, digest) => {
        expect(() => parseArgs(['--approved-quarantine-digest', digest]))
            .toThrow('embedding_audit_approved_quarantine_digest_invalid');
    });
});

describe('auditEmbeddingContracts exit contract', () => {
    it('uses only 0 for pass, 2 for complete evidence failure, and 3 for program failure', () => {
        expect(EMBEDDING_AUDIT_EXIT_PASS).toBe(0);
        expect(EMBEDDING_AUDIT_EXIT_EVIDENCE_FAILURE).toBe(2);
        expect(EMBEDDING_AUDIT_EXIT_PROGRAM_FAILURE).toBe(3);
        expect(resolveEmbeddingAuditExitCode({
            strict: true,
            diagnosticOnly: false,
            embeddingEvidence: scanResult().embeddingEvidence,
            approvedQuarantineDigest: EMPTY_QUARANTINE_DIGEST,
        })).toBe(0);
        expect(resolveEmbeddingAuditExitCode({
            strict: true,
            diagnosticOnly: false,
            embeddingEvidence: scanResult({
                postFeatureSnapshots: { verified_local_fallback: 0, invalid: 1 },
            }).embeddingEvidence,
            approvedQuarantineDigest: EMPTY_QUARANTINE_DIGEST,
        })).toBe(2);
        expect(resolveEmbeddingAuditExitCode({
            strict: false,
            diagnosticOnly: true,
            embeddingEvidence: scanResult({
                postFeatureSnapshots: { verified_local_fallback: 0, invalid: 1 },
            }).embeddingEvidence,
        })).toBe(0);
    });

    it('requires the canonical digest even when the quarantine cohort is empty', () => {
        const evidence = scanResult().embeddingEvidence;

        expect(resolveEmbeddingAuditExitCode({
            strict: true,
            diagnosticOnly: false,
            embeddingEvidence: evidence,
        })).toBe(2);
        expect(resolveEmbeddingAuditExitCode({
            strict: true,
            diagnosticOnly: false,
            embeddingEvidence: evidence,
            approvedQuarantineDigest: 'b'.repeat(64),
        })).toBe(2);
        expect(resolveEmbeddingAuditExitCode({
            strict: true,
            diagnosticOnly: false,
            embeddingEvidence: evidence,
            approvedQuarantineDigest: EMPTY_QUARANTINE_DIGEST,
        })).toBe(0);
    });

    it('requires an external quarantine digest in strict mode and rejects drift', () => {
        const evidence = scanResult({
            userVectors: {
                verified_local_fallback: 1,
                quarantined: 1,
            },
            quarantineDigest: 'a'.repeat(64),
        }).embeddingEvidence;

        expect(resolveEmbeddingAuditExitCode({
            strict: true,
            diagnosticOnly: false,
            embeddingEvidence: evidence,
            approvedQuarantineDigest: EMPTY_QUARANTINE_DIGEST,
        })).toBe(2);
        expect(resolveEmbeddingAuditExitCode({
            strict: true,
            diagnosticOnly: false,
            embeddingEvidence: evidence,
            approvedQuarantineDigest: 'b'.repeat(64),
        })).toBe(2);
        expect(resolveEmbeddingAuditExitCode({
            strict: true,
            diagnosticOnly: false,
            embeddingEvidence: evidence,
            approvedQuarantineDigest: 'a'.repeat(64),
        })).toBe(0);
    });

    it('rejects diagnostic scan metadata even when counts look releasable', () => {
        const evidence = scanResult().embeddingEvidence;
        evidence.scan.diagnosticOnly = true;

        expect(resolveEmbeddingAuditExitCode({
            strict: true,
            diagnosticOnly: false,
            embeddingEvidence: evidence,
            approvedQuarantineDigest: EMPTY_QUARANTINE_DIGEST,
        })).toBe(2);
    });

    it('rejects aggregate and cohort drift', () => {
        const evidence = scanResult().embeddingEvidence;
        evidence.cohorts.postFeatureSnapshots = counts({ invalid: 1 });

        expect(resolveEmbeddingAuditExitCode({
            strict: true,
            diagnosticOnly: false,
            embeddingEvidence: evidence,
            approvedQuarantineDigest: EMPTY_QUARANTINE_DIGEST,
        })).toBe(2);
    });

    it('rejects fabricated semantic-ready evidence', () => {
        expect(resolveEmbeddingAuditExitCode({
            strict: true,
            diagnosticOnly: false,
            embeddingEvidence: scanResult({
                userVectors: {
                    verified_local_fallback: 1,
                    semantic_ready: 1,
                },
            }).embeddingEvidence,
            approvedQuarantineDigest: EMPTY_QUARANTINE_DIGEST,
        })).toBe(2);
    });
});

describe('runEmbeddingContractAuditCli', () => {
    it('runs a strict full scan in one snapshot transaction and writes JSON on evidence failure', async () => {
        const order: string[] = [];
        const session = {
            withTransaction: vi.fn(async (callback: () => Promise<void>) => {
                order.push('transaction');
                await callback();
            }),
            endSession: vi.fn(() => order.push('end-session')),
        };
        const scan = vi.fn(async ({ limit }: { limit?: number; session?: unknown }) => {
            order.push(`scan:${String(limit)}`);
            return scanResult({
                postFeatureSnapshots: { verified_local_fallback: 0, invalid: 1 },
            });
        });
        const writeJson = vi.fn(() => order.push('json'));

        const exitCode = await runEmbeddingContractAuditCli([
            '--strict',
            '--approved-quarantine-digest',
            EMPTY_QUARANTINE_DIGEST,
        ], {
            connectMongo: vi.fn(async () => {
                order.push('connect');
                return { evidenceFile: '/tmp/read-only.json', evidenceFileSha256: 'c'.repeat(64) };
            }),
            startSession: vi.fn(async () => {
                order.push('start-session');
                return session;
            }),
            scan,
            writeJson,
            writeError: vi.fn(),
        });

        expect(exitCode).toBe(EMBEDDING_AUDIT_EXIT_EVIDENCE_FAILURE);
        expect(session.withTransaction).toHaveBeenCalledWith(
            expect.any(Function),
            { readConcern: { level: 'snapshot' } },
        );
        expect(scan).toHaveBeenCalledWith({ limit: undefined, session });
        expect(order).toEqual([
            'connect',
            'start-session',
            'transaction',
            'scan:undefined',
            'end-session',
            'json',
        ]);
        expect(writeJson).toHaveBeenCalledWith(expect.objectContaining({
            diagnosticOnly: false,
            releasePass: false,
        }));
    });

    it('returns pass after a successful strict snapshot with complete evidence', async () => {
        const session = snapshotSession();
        const writeJson = vi.fn();

        const exitCode = await runEmbeddingContractAuditCli([
            '--strict',
            '--approved-quarantine-digest',
            EMPTY_QUARANTINE_DIGEST,
        ], dependencies({
            startSession: vi.fn().mockResolvedValue(session),
            writeJson,
        }));

        expect(exitCode).toBe(EMBEDDING_AUDIT_EXIT_PASS);
        expect(writeJson).toHaveBeenCalledWith(expect.objectContaining({ releasePass: true }));
        expect(session.endSession).toHaveBeenCalledOnce();
    });

    it.each([
        ['limited', ['--limit', '5'], { limit: 5 }],
        ['full', [], { limit: undefined }],
    ])('does not start a session for a non-strict %s scan', async (_mode, argv, scanOptions) => {
        const scan = vi.fn(async () => scanResult());
        const startSession = vi.fn();
        const exitCode = await runEmbeddingContractAuditCli(argv as string[], dependencies({
            scan,
            startSession,
        }));

        expect(exitCode).toBe(EMBEDDING_AUDIT_EXIT_PASS);
        expect(startSession).not.toHaveBeenCalled();
        expect(scan).toHaveBeenCalledWith(scanOptions);
    });

    it('fails closed and ends the session when snapshot transactions are unsupported', async () => {
        const endSession = vi.fn();
        const scan = vi.fn();
        const writeJson = vi.fn();
        const writeError = vi.fn();

        const exitCode = await runEmbeddingContractAuditCli(['--strict'], dependencies({
            startSession: vi.fn().mockResolvedValue({ endSession }),
            scan,
            writeJson,
            writeError,
        }));

        expect(exitCode).toBe(EMBEDDING_AUDIT_EXIT_PROGRAM_FAILURE);
        expect(scan).not.toHaveBeenCalled();
        expect(writeJson).not.toHaveBeenCalled();
        expect(writeError).toHaveBeenCalledWith(expect.stringContaining(
            'embedding_audit_snapshot_transaction_unsupported',
        ));
        expect(endSession).toHaveBeenCalledOnce();
    });

    it('maps a snapshot session topology rejection to exit 3 without release JSON', async () => {
        const scan = vi.fn();
        const writeJson = vi.fn();

        const exitCode = await runEmbeddingContractAuditCli(['--strict'], dependencies({
            startSession: vi.fn().mockRejectedValue(new Error('topology has no sessions')),
            scan,
            writeJson,
        }));

        expect(exitCode).toBe(EMBEDDING_AUDIT_EXIT_PROGRAM_FAILURE);
        expect(scan).not.toHaveBeenCalled();
        expect(writeJson).not.toHaveBeenCalled();
    });

    it.each([
        ['transaction', new Error('snapshot topology unsupported'), false],
        ['cursor', new Error('cursor rejected'), true],
    ])('maps a strict snapshot %s rejection to exit 3 and ends the session', async (
        _failure,
        error,
        invokeScan,
    ) => {
        const session = snapshotSession(invokeScan ? undefined : error);
        const scan = invokeScan
            ? vi.fn().mockRejectedValue(error)
            : vi.fn().mockResolvedValue(scanResult());
        const writeJson = vi.fn();

        const exitCode = await runEmbeddingContractAuditCli(['--strict'], dependencies({
            startSession: vi.fn().mockResolvedValue(session),
            scan,
            writeJson,
        }));

        expect(exitCode).toBe(EMBEDDING_AUDIT_EXIT_PROGRAM_FAILURE);
        expect(scan).toHaveBeenCalledTimes(invokeScan ? 1 : 0);
        expect(writeJson).not.toHaveBeenCalled();
        expect(session.endSession).toHaveBeenCalledOnce();
    });

    it('maps access and unexpected failures to program exit 3 before model scan', async () => {
        const scan = vi.fn();
        const writeError = vi.fn();

        const exitCode = await runEmbeddingContractAuditCli([], dependencies({
            connectMongo: vi.fn().mockRejectedValue(new Error('access denied')),
            scan,
            writeError,
        }));

        expect(exitCode).toBe(EMBEDDING_AUDIT_EXIT_PROGRAM_FAILURE);
        expect(scan).not.toHaveBeenCalled();
        expect(writeError).toHaveBeenCalledWith(expect.stringMatching(/^\[AuditEmbeddingContracts\] failed:/));
    });
});

function dependencies(overrides: Record<string, unknown> = {}) {
    return {
        connectMongo: vi.fn().mockResolvedValue({
            evidenceFile: '/tmp/read-only.json',
            evidenceFileSha256: 'c'.repeat(64),
        }),
        scan: vi.fn().mockResolvedValue(scanResult()),
        writeJson: vi.fn(),
        writeError: vi.fn(),
        ...overrides,
    };
}

function snapshotSession(transactionError?: Error) {
    return {
        withTransaction: vi.fn(async (
            callback: () => Promise<void>,
            _options?: Record<string, unknown>,
        ) => {
            if (transactionError) throw transactionError;
            await callback();
        }),
        endSession: vi.fn(),
    };
}

type CountOverrides = Partial<{
    verified_local_fallback: number;
    semantic_ready: number;
    quarantined: number;
    invalid: number;
    unclassified: number;
}>;

function scanResult(overrides: Partial<{
    userVectors: CountOverrides;
    postFeatureSnapshots: CountOverrides;
    quarantineDigest: string;
}> = {}): EmbeddingEvidenceScanResult {
    const userVectors = counts({
        verified_local_fallback: 2,
        ...overrides.userVectors,
    });
    const postFeatureSnapshots = counts({
        verified_local_fallback: 1,
        ...overrides.postFeatureSnapshots,
    });
    const aggregate = counts({
        verified_local_fallback: userVectors.verified_local_fallback + postFeatureSnapshots.verified_local_fallback,
        semantic_ready: userVectors.semantic_ready + postFeatureSnapshots.semantic_ready,
        quarantined: userVectors.quarantined + postFeatureSnapshots.quarantined,
        invalid: userVectors.invalid + postFeatureSnapshots.invalid,
        unclassified: userVectors.unclassified + postFeatureSnapshots.unclassified,
    });
    return {
        embeddingEvidence: {
            ...aggregate,
            cohorts: { userVectors, postFeatureSnapshots },
            quarantineDigest: overrides.quarantineDigest ?? EMPTY_QUARANTINE_DIGEST,
            scan: {
                userDocuments: 1,
                postFeatureSnapshots: 1,
                mode: 'full',
                limit: null,
                diagnosticOnly: false,
                ordering: '_id_ascending',
            },
        },
    };
}

function counts(overrides: CountOverrides = {}) {
    const values = {
        verified_local_fallback: 0,
        semantic_ready: 0,
        quarantined: 0,
        invalid: 0,
        unclassified: 0,
        ...overrides,
    };
    return {
        total: values.verified_local_fallback
            + values.semantic_ready
            + values.quarantined
            + values.invalid
            + values.unclassified,
        ...values,
    };
}
