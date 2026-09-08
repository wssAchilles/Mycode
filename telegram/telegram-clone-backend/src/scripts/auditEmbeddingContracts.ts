import mongoose from 'mongoose';

import {
    connectRecommendationAuditMongo,
    type RecommendationAuditMongoEvidence,
} from '../services/ops/recommendation/auditMongoAccess';
import {
    scanEmbeddingContractEvidence,
    isFullEmbeddingEvidenceSummary,
    type EmbeddingEvidenceScanResult,
    type PersistedEmbeddingEvidenceSummary,
} from '../services/ops/recommendation/embeddingEvidenceAudit';
import { disconnectMongoDB } from '../config/db';

export const EMBEDDING_AUDIT_EXIT_PASS = 0 as const;
export const EMBEDDING_AUDIT_EXIT_EVIDENCE_FAILURE = 2 as const;
export const EMBEDDING_AUDIT_EXIT_PROGRAM_FAILURE = 3 as const;

export interface EmbeddingAuditArguments {
    strict: boolean;
    limit: number | undefined;
    diagnosticOnly: boolean;
    approvedQuarantineDigest: string | undefined;
}

type EmbeddingAuditCliDependencies = {
    connectMongo: () => Promise<RecommendationAuditMongoEvidence>;
    startSession: () => Promise<EmbeddingAuditSession>;
    scan: (options: { limit?: number; session?: unknown }) => Promise<EmbeddingEvidenceScanResult>;
    writeJson: (value: unknown) => void;
    writeError: (message: string) => void;
};

type EmbeddingAuditSession = {
    withTransaction?: (
        callback: () => Promise<void>,
        options?: Record<string, unknown>,
    ) => Promise<unknown>;
    endSession?: () => Promise<void> | void;
};

export function parseArgs(argv: readonly string[]): EmbeddingAuditArguments {
    let strict = false;
    let limit: number | undefined;
    let approvedQuarantineDigest: string | undefined;

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        switch (argument) {
            case '--strict':
                strict = true;
                break;
            case '--limit': {
                const value = argv[index + 1];
                if (!value || value.startsWith('--') || !/^\d+$/.test(value) || Number(value) < 1) {
                    throw new Error('embedding_audit_limit_invalid');
                }
                limit = Number(value);
                index += 1;
                break;
            }
            case '--approved-quarantine-digest': {
                const value = argv[index + 1];
                if (!value || !/^[a-f0-9]{64}$/.test(value)) {
                    throw new Error('embedding_audit_approved_quarantine_digest_invalid');
                }
                approvedQuarantineDigest = value;
                index += 1;
                break;
            }
            default:
                throw new Error(`embedding_audit_argument_unknown:${argument}`);
        }
    }

    if (strict && limit !== undefined) {
        throw new Error('embedding_audit_limited_strict_forbidden');
    }

    return {
        strict,
        limit,
        diagnosticOnly: limit !== undefined,
        approvedQuarantineDigest,
    };
}

export function resolveEmbeddingAuditExitCode({
    strict,
    diagnosticOnly,
    embeddingEvidence,
    approvedQuarantineDigest,
}: {
    strict: boolean;
    diagnosticOnly: boolean;
    embeddingEvidence: PersistedEmbeddingEvidenceSummary;
    approvedQuarantineDigest?: string;
}): typeof EMBEDDING_AUDIT_EXIT_PASS | typeof EMBEDDING_AUDIT_EXIT_EVIDENCE_FAILURE {
    if (!strict || diagnosticOnly) return EMBEDDING_AUDIT_EXIT_PASS;

    const evidenceFailed = !isFullEmbeddingEvidenceSummary(embeddingEvidence)
        || embeddingEvidence.scan.userDocuments < 1
        || embeddingEvidence.scan.postFeatureSnapshots < 1
        || embeddingEvidence.invalid > 0
        || embeddingEvidence.unclassified > 0
        || approvedQuarantineDigest !== embeddingEvidence.quarantineDigest;
    return evidenceFailed
        ? EMBEDDING_AUDIT_EXIT_EVIDENCE_FAILURE
        : EMBEDDING_AUDIT_EXIT_PASS;
}

export async function runEmbeddingContractAuditCli(
    argv: readonly string[],
    dependencyOverrides: Partial<EmbeddingAuditCliDependencies> = {},
): Promise<
    | typeof EMBEDDING_AUDIT_EXIT_PASS
    | typeof EMBEDDING_AUDIT_EXIT_EVIDENCE_FAILURE
    | typeof EMBEDDING_AUDIT_EXIT_PROGRAM_FAILURE
> {
    const dependencies: EmbeddingAuditCliDependencies = {
        connectMongo: connectRecommendationAuditMongo,
        startSession: () => mongoose.startSession() as unknown as Promise<EmbeddingAuditSession>,
        scan: scanEmbeddingContractEvidence,
        writeJson: (value) => console.log(JSON.stringify(value, null, 2)),
        writeError: (message) => console.error(message),
        ...dependencyOverrides,
    };

    try {
        const arguments_ = parseArgs(argv);
        const auditMongoEvidence = await dependencies.connectMongo();
        const { embeddingEvidence } = arguments_.strict
            ? await scanStrictSnapshot(arguments_.limit, dependencies)
            : await dependencies.scan({ limit: arguments_.limit });
        const exitCode = resolveEmbeddingAuditExitCode({
            strict: arguments_.strict,
            diagnosticOnly: arguments_.diagnosticOnly,
            embeddingEvidence,
            approvedQuarantineDigest: arguments_.approvedQuarantineDigest,
        });

        dependencies.writeJson({
            auditedAt: new Date().toISOString(),
            strict: arguments_.strict,
            diagnosticOnly: arguments_.diagnosticOnly,
            releasePass: arguments_.strict
                && !arguments_.diagnosticOnly
                && exitCode === EMBEDDING_AUDIT_EXIT_PASS,
            quarantineApproval: quarantineApproval(
                embeddingEvidence,
                arguments_.approvedQuarantineDigest,
            ),
            auditMongoEvidence: {
                ...auditMongoEvidence,
                meaning: 'operator_review_only',
            },
            embeddingEvidence,
        });
        return exitCode;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dependencies.writeError(`[AuditEmbeddingContracts] failed: ${message}`);
        return EMBEDDING_AUDIT_EXIT_PROGRAM_FAILURE;
    }
}

async function scanStrictSnapshot(
    limit: number | undefined,
    dependencies: EmbeddingAuditCliDependencies,
): Promise<EmbeddingEvidenceScanResult> {
    const session = await dependencies.startSession();
    let result: EmbeddingEvidenceScanResult | undefined;
    try {
        if (typeof session.withTransaction !== 'function') {
            throw new Error('embedding_audit_snapshot_transaction_unsupported');
        }
        await session.withTransaction(
            async () => {
                result = await dependencies.scan({ limit, session });
            },
            { readConcern: { level: 'snapshot' } },
        );
    } finally {
        await session.endSession?.();
    }
    if (!result) throw new Error('embedding_audit_snapshot_transaction_incomplete');
    return result;
}

function quarantineApproval(
    evidence: PersistedEmbeddingEvidenceSummary,
    approvedDigest: string | undefined,
): 'missing' | 'matched' | 'mismatch' {
    if (!approvedDigest) return 'missing';
    return approvedDigest === evidence.quarantineDigest ? 'matched' : 'mismatch';
}

if (require.main === module) {
    runEmbeddingContractAuditCli(process.argv.slice(2))
        .then((exitCode) => {
            process.exitCode = exitCode;
        })
        .finally(disconnectMongoDB);
}
