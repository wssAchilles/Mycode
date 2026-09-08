import crypto from 'crypto';
import { readFile } from 'fs/promises';

import { connectMongoDB } from '../../../config/db';

const EVIDENCE_FIELDS = [
    'schemaVersion',
    'reviewedBy',
    'reviewedAt',
    'expiresAt',
    'database',
    'role',
    'mongodbUriSha256',
] as const;

export type RecommendationAuditMongoAccessErrorCode =
    | 'recommendation_audit_uri_missing'
    | 'recommendation_audit_evidence_file_missing'
    | 'recommendation_audit_evidence_invalid'
    | 'recommendation_audit_role_not_allowed'
    | 'recommendation_audit_evidence_expired'
    | 'recommendation_audit_uri_digest_mismatch';

export class RecommendationAuditMongoAccessError extends Error {
    constructor(
        public readonly code: RecommendationAuditMongoAccessErrorCode,
        detail: string,
    ) {
        super(`${code}: ${detail}`);
        this.name = 'RecommendationAuditMongoAccessError';
    }
}

export interface RecommendationAuditMongoEvidence {
    evidenceFile: string;
    evidenceFileSha256: string;
}

type ParsedReadOnlyEvidence = {
    schemaVersion: 1;
    reviewedBy: string;
    reviewedAt: string;
    expiresAt: string;
    database: string;
    role: unknown;
    mongodbUriSha256: string;
};

export interface RecommendationAuditReadOnlyEvidence extends Omit<ParsedReadOnlyEvidence, 'role'> {
    role: 'read';
}

export async function connectRecommendationAuditMongo(): Promise<RecommendationAuditMongoEvidence> {
    const uri = process.env.RECOMMENDATION_AUDIT_MONGODB_URI;
    if (!uri || !uri.trim()) {
        throw accessError('recommendation_audit_uri_missing', 'RECOMMENDATION_AUDIT_MONGODB_URI is required');
    }

    const evidenceFile = process.env.RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE?.trim();
    if (!evidenceFile) {
        throw accessError(
            'recommendation_audit_evidence_file_missing',
            'RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE is required',
        );
    }

    let raw: Buffer;
    try {
        raw = await readFile(evidenceFile);
    } catch {
        throw accessError('recommendation_audit_evidence_invalid', 'evidence file cannot be read');
    }

    const evidence = validateRecommendationAuditEvidence(raw);

    const actualDigest = sha256(uri);
    if (!safeEqual(evidence.mongodbUriSha256, actualDigest)) {
        throw accessError('recommendation_audit_uri_digest_mismatch', 'evidence is not bound to the exact audit URI');
    }

    await connectMongoDB({
        uri,
        autoIndex: false,
        autoCreate: false,
        quiet: true,
    });

    return {
        evidenceFile,
        evidenceFileSha256: sha256(raw),
    };
}

export function validateRecommendationAuditEvidence(
    raw: Buffer,
    now: Date | number = Date.now(),
): RecommendationAuditReadOnlyEvidence {
    const evidence = parseEvidence(raw);
    if (evidence.role !== 'read') {
        throw accessError('recommendation_audit_role_not_allowed', 'operator-reviewed role must be read');
    }
    const nowMs = now instanceof Date ? now.getTime() : now;
    const reviewedAtMs = Date.parse(evidence.reviewedAt);
    const expiresAtMs = Date.parse(evidence.expiresAt);
    if (!Number.isFinite(nowMs) || reviewedAtMs > nowMs || reviewedAtMs >= expiresAtMs) {
        throw accessError('recommendation_audit_evidence_invalid', 'operator review dates are invalid');
    }
    if (expiresAtMs <= nowMs) {
        throw accessError('recommendation_audit_evidence_expired', 'operator review has expired');
    }
    return evidence as RecommendationAuditReadOnlyEvidence;
}

function parseEvidence(raw: Buffer): ParsedReadOnlyEvidence {
    let value: unknown;
    try {
        value = JSON.parse(raw.toString('utf8'));
    } catch {
        throw accessError('recommendation_audit_evidence_invalid', 'evidence must be valid JSON');
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw accessError('recommendation_audit_evidence_invalid', 'evidence must be an object');
    }
    const candidate = value as Record<string, unknown>;
    const fields = Object.keys(candidate).sort();
    const expectedFields = [...EVIDENCE_FIELDS].sort();
    if (fields.length !== expectedFields.length
        || fields.some((field, index) => field !== expectedFields[index])
        || candidate.schemaVersion !== 1
        || !isNonEmptyString(candidate.reviewedBy)
        || !isNonEmptyString(candidate.database)
        || !isParseableDate(candidate.reviewedAt)
        || !isParseableDate(candidate.expiresAt)
        || typeof candidate.mongodbUriSha256 !== 'string'
        || !/^[a-f0-9]{64}$/.test(candidate.mongodbUriSha256)) {
        throw accessError('recommendation_audit_evidence_invalid', 'evidence schema is invalid');
    }
    return candidate as ParsedReadOnlyEvidence;
}

function accessError(
    code: RecommendationAuditMongoAccessErrorCode,
    detail: string,
): RecommendationAuditMongoAccessError {
    return new RecommendationAuditMongoAccessError(code, detail);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isParseableDate(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function sha256(value: crypto.BinaryLike): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqual(left: string, right: string): boolean {
    return crypto.timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}
