import {
    parseRequiredCutoff,
    sha256,
    stableStringify,
    type PitSafePartialManifest,
} from '../pitSafePartialExport';
import {
    ANN_ARTIFACT_MANIFEST_VERSION,
    DATASET_ACCEPTANCE_VERSION,
    RECOMMENDATION_TRAINING_EXAMPLE_VERSION,
    type AnnArtifactManifestV1,
    type DatasetAcceptanceApprovalConfigV1,
    type DatasetAcceptanceV1,
    type RecommendationTrainingExampleV1,
    type TrainingArtifactIdentity,
    type TrainingArtifactIdentityInput,
} from './contracts';

type Phase3Artifacts = {
    validNdjson: string;
    quarantineNdjson: string;
    manifest: PitSafePartialManifest;
};

export type VersionedTrainingArtifactsInput = {
    phase3Artifacts: Phase3Artifacts;
    identity: TrainingArtifactIdentityInput;
    annArtifact: {
        built?: boolean;
        bytes: string | Uint8Array;
        metric: string;
        normalization: string;
        dimension: number;
        count: number;
    };
    approvalConfig?: DatasetAcceptanceApprovalConfigV1;
};

export type VersionedTrainingArtifacts = {
    validNdjson: string;
    quarantineNdjson: string;
    datasetDigest: string;
    annManifest: AnnArtifactManifestV1;
    annManifestJson: string;
    datasetAcceptance: DatasetAcceptanceV1;
    datasetAcceptanceJson: string;
};

function toBytes(value: string | Uint8Array): Uint8Array {
    return typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
}

function parseNdjson(value: string): Array<Record<string, unknown>> {
    if (!value) return [];
    return value.trim().split('\n').filter(Boolean).map((line) => {
        const parsed: unknown = JSON.parse(line);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('invalid_training_example');
        }
        return parsed as Record<string, unknown>;
    });
}

function toNdjson(rows: RecommendationTrainingExampleV1[]): string {
    return rows.length === 0 ? '' : `${rows.map(stableStringify).join('\n')}\n`;
}

function nonEmpty(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function quarantineReasonSummary(rows: Array<Record<string, unknown>>) {
    const counts = new Map<string, number>();
    let valid = true;
    for (const row of rows) {
        if (!Array.isArray(row.quarantineReasons) || row.quarantineReasons.length === 0) {
            valid = false;
            continue;
        }
        for (const reason of row.quarantineReasons) {
            if (!nonEmpty(reason)) {
                valid = false;
                continue;
            }
            counts.set(reason, (counts.get(reason) || 0) + 1);
        }
    }
    return { valid, counts: Object.fromEntries(counts) };
}

function hasCompleteIdentity(identity: unknown): identity is TrainingArtifactIdentity {
    if (!isRecord(identity)
        || !isRecord(identity.model)
        || !isRecord(identity.artifact)
        || !isRecord(identity.index)) return false;
    return [
        identity.servingIdNamespace,
        identity.modelIdNamespace,
        identity.pipelineVersion,
        identity.graphVersion,
        identity.model.id,
        identity.model.version,
        identity.artifact.id,
        identity.artifact.version,
        identity.index.namespace,
        identity.index.id,
        identity.index.version,
    ].every(nonEmpty);
}

function sameIdentity(
    left: TrainingArtifactIdentity,
    right: TrainingArtifactIdentity,
): boolean {
    return stableStringify(left) === stableStringify(right);
}

function validCountThreshold(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function validPitCoverage(value: unknown): value is number {
    return typeof value === 'number'
        && Number.isFinite(value)
        && value >= 0
        && value <= 1;
}

function validApprovalConfig(
    config: DatasetAcceptanceApprovalConfigV1,
): boolean {
    return config.configVersion === DATASET_ACCEPTANCE_VERSION
        && /^[0-9a-f]{64}$/.test(config.approvedContentDigest)
        && validCountThreshold(config.minValidQueries)
        && validCountThreshold(config.minPositiveLabels)
        && validCountThreshold(config.minNegativeLabels)
        && validPitCoverage(config.minPitCoverage);
}

function versionRow(
    row: Record<string, unknown>,
    datasetVersion: string,
    identity: TrainingArtifactIdentity,
): RecommendationTrainingExampleV1 {
    const featureProvenance = row.featureProvenance;
    return {
        ...row,
        exampleVersion: RECOMMENDATION_TRAINING_EXAMPLE_VERSION,
        datasetVersion,
        servingPostId: typeof row.postId === 'string' ? row.postId : '',
        modelPostId: typeof row.modelPostId === 'string' ? row.modelPostId : '',
        servingIdNamespace: identity.servingIdNamespace,
        modelIdNamespace: identity.modelIdNamespace,
        featureProvenance: featureProvenance
            && typeof featureProvenance === 'object'
            && !Array.isArray(featureProvenance)
            ? featureProvenance as Record<string, unknown>
            : {},
        pipelineVersion: identity.pipelineVersion,
        graphVersion: identity.graphVersion,
        modelId: identity.model.id,
        modelVersion: identity.model.version,
        artifactId: identity.artifact.id,
        artifactVersion: identity.artifact.version,
        indexNamespace: identity.index.namespace,
        indexId: identity.index.id,
        indexVersion: identity.index.version,
    };
}

export function buildVersionedTrainingArtifacts(
    input: VersionedTrainingArtifactsInput,
): VersionedTrainingArtifacts {
    const cutoff = parseRequiredCutoff(input.phase3Artifacts.manifest.cutoff).toISOString();
    const annBytes = toBytes(input.annArtifact.bytes);
    const artifactBuilt = input.annArtifact.built === true;
    const indexVersion = artifactBuilt ? sha256(stableStringify({
        cutoff,
        contentBase64: Buffer.from(annBytes).toString('base64'),
        metric: input.annArtifact.metric,
        normalization: input.annArtifact.normalization,
        dimension: input.annArtifact.dimension,
        count: input.annArtifact.count,
    })) : 'artifact_unbuilt';
    const phase3Manifest = input.phase3Artifacts.manifest;
    const digestManifest = {
        manifestVersion: phase3Manifest.manifestVersion,
        trainingReady: phase3Manifest.trainingReady,
        cutoff,
        counts: phase3Manifest.counts,
        reasonCounts: phase3Manifest.reasonCounts,
        pitCoverage: phase3Manifest.pitCoverage,
        validSha256: phase3Manifest.files.valid.sha256,
        quarantineSha256: phase3Manifest.files.quarantine.sha256,
    };
    const datasetDigest = sha256(stableStringify({
        validNdjson: input.phase3Artifacts.validNdjson,
        quarantineNdjson: input.phase3Artifacts.quarantineNdjson,
        phase3Manifest: digestManifest,
        identity: input.identity,
        indexVersion,
    }));
    const identity: TrainingArtifactIdentity = {
        ...input.identity,
        model: { ...input.identity.model },
        artifact: { ...input.identity.artifact, version: datasetDigest },
        index: { ...input.identity.index, version: indexVersion },
    };
    const validRows = parseNdjson(input.phase3Artifacts.validNdjson);
    const quarantineRows = parseNdjson(input.phase3Artifacts.quarantineNdjson);
    const validExamples = validRows.length;
    const totalExamples = validRows.length + quarantineRows.length;
    const pitCoverage = totalExamples === 0 ? 0 : validRows.length / totalExamples;
    const quarantineReasons = quarantineReasonSummary(quarantineRows);
    const phase3ArtifactsConsistent = input.phase3Artifacts.manifest.manifestVersion
        === 'pit-safe-partial'
        && input.phase3Artifacts.manifest.trainingReady === false
        && input.phase3Artifacts.manifest.counts.input === totalExamples
        && input.phase3Artifacts.manifest.counts.valid === validRows.length
        && input.phase3Artifacts.manifest.counts.quarantine === quarantineRows.length
        && input.phase3Artifacts.manifest.pitCoverage === pitCoverage
        && quarantineReasons.valid
        && stableStringify(input.phase3Artifacts.manifest.reasonCounts)
            === stableStringify(quarantineReasons.counts)
        && input.phase3Artifacts.manifest.files.valid.sha256
            === sha256(input.phase3Artifacts.validNdjson)
        && input.phase3Artifacts.manifest.files.quarantine.sha256
            === sha256(input.phase3Artifacts.quarantineNdjson);
    const validQueries = new Set(validRows.flatMap((row) => (
        nonEmpty(row.requestId) ? [row.requestId] : []
    ))).size;
    const positiveLabels = validRows.filter((row) => row.feedbackLabel === 'positive').length;
    const negativeLabels = validRows.filter((row) => row.feedbackLabel === 'negative').length;
    const observed = {
        validExamples,
        validQueries,
        positiveLabels,
        negativeLabels,
        pitCoverage,
    };
    const diagnostics: string[] = [];
    const approval = input.approvalConfig;

    if (!hasCompleteIdentity(identity)) diagnostics.push('artifact_identity_incomplete');
    if (!phase3ArtifactsConsistent) diagnostics.push('phase3_artifacts_inconsistent');
    if ([...validRows, ...quarantineRows].some((row) => (
        !nonEmpty(row.postId)
        || !nonEmpty(row.modelPostId)
        || !isRecord(row.featureProvenance)
    ))) diagnostics.push('training_example_identity_incomplete');
    if (!artifactBuilt) diagnostics.push('artifact_unbuilt');
    if (artifactBuilt && (annBytes.byteLength === 0 || input.annArtifact.count === 0)) {
        diagnostics.push('ann_artifact_empty');
    }
    if (!nonEmpty(input.annArtifact.metric)
        || !nonEmpty(input.annArtifact.normalization)
        || !Number.isInteger(input.annArtifact.dimension)
        || input.annArtifact.dimension <= 0
        || !Number.isInteger(input.annArtifact.count)
        || input.annArtifact.count < 0) {
        diagnostics.push('ann_artifact_invalid');
    }
    if (!approval) {
        diagnostics.push('approval_config_missing');
    } else if (!validApprovalConfig(approval)) {
        diagnostics.push('approval_config_invalid');
    } else {
        const approvalIdentityComplete = hasCompleteIdentity(approval.identity);
        if (!approvalIdentityComplete) {
            diagnostics.push('approval_identity_incomplete');
        }
        if (approval.approvedContentDigest !== datasetDigest) {
            diagnostics.push('approved_digest_mismatch');
        }
        if (approvalIdentityComplete && !sameIdentity(approval.identity, identity)) {
            diagnostics.push('approved_identity_mismatch');
        }
        if (validExamples === 0) diagnostics.push('valid_examples_missing');
        if (validQueries < approval.minValidQueries) {
            diagnostics.push('min_valid_queries_not_met');
        }
        if (positiveLabels < approval.minPositiveLabels) {
            diagnostics.push('min_positive_labels_not_met');
        }
        if (negativeLabels < approval.minNegativeLabels) {
            diagnostics.push('min_negative_labels_not_met');
        }
        if (observed.pitCoverage < approval.minPitCoverage) {
            diagnostics.push('min_pit_coverage_not_met');
        }
    }

    const trainingReady = diagnostics.length === 0;
    const mode = trainingReady ? 'approved' : 'diagnostic';
    const datasetAcceptance: DatasetAcceptanceV1 = {
        acceptanceVersion: DATASET_ACCEPTANCE_VERSION,
        mode,
        trainingReady,
        datasetDigest,
        approvedContentDigest: approval?.approvedContentDigest || null,
        identity,
        observed,
        thresholds: approval ? {
            minValidQueries: approval.minValidQueries,
            minPositiveLabels: approval.minPositiveLabels,
            minNegativeLabels: approval.minNegativeLabels,
            minPitCoverage: approval.minPitCoverage,
        } : null,
        diagnostics,
    };
    const annManifest: AnnArtifactManifestV1 = {
        manifestVersion: ANN_ARTIFACT_MANIFEST_VERSION,
        mode,
        trainingReady,
        cutoff,
        metric: input.annArtifact.metric,
        normalization: input.annArtifact.normalization,
        dimension: input.annArtifact.dimension,
        count: input.annArtifact.count,
        sha256: sha256(annBytes),
        indexNamespace: identity.index.namespace,
        indexId: identity.index.id,
        indexVersion,
    };

    return {
        validNdjson: toNdjson(validRows.map((row) => versionRow(row, datasetDigest, identity))),
        quarantineNdjson: toNdjson(
            quarantineRows.map((row) => versionRow(row, datasetDigest, identity)),
        ),
        datasetDigest,
        annManifest,
        annManifestJson: `${stableStringify(annManifest)}\n`,
        datasetAcceptance,
        datasetAcceptanceJson: `${stableStringify(datasetAcceptance)}\n`,
    };
}
