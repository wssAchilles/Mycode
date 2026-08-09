export const RECOMMENDATION_TRAINING_EXAMPLE_VERSION = (
    'recommendation_training_example_v1'
) as const;
export const ANN_ARTIFACT_MANIFEST_VERSION = 'ann_artifact_manifest_v1' as const;
export const DATASET_ACCEPTANCE_VERSION = 'dataset_acceptance_v1' as const;

export type ArtifactMode = 'diagnostic' | 'approved';

export type TrainingArtifactIdentityInput = {
    servingIdNamespace: string;
    modelIdNamespace: string;
    pipelineVersion: string;
    graphVersion: string;
    model: { id: string; version: string };
    artifact: { id: string };
    index: { namespace: string; id: string };
};

export type TrainingArtifactIdentity = Omit<TrainingArtifactIdentityInput, 'artifact' | 'index'> & {
    artifact: TrainingArtifactIdentityInput['artifact'] & { version: string };
    index: TrainingArtifactIdentityInput['index'] & { version: string };
};

export type DatasetAcceptanceApprovalConfigV1 = {
    configVersion: typeof DATASET_ACCEPTANCE_VERSION;
    approvedContentDigest: string;
    minValidQueries: number;
    minPositiveLabels: number;
    minNegativeLabels: number;
    minPitCoverage: number;
    identity: TrainingArtifactIdentity;
};

export type RecommendationTrainingExampleV1 = Record<string, unknown> & {
    exampleVersion: typeof RECOMMENDATION_TRAINING_EXAMPLE_VERSION;
    datasetVersion: string;
    servingPostId: string;
    modelPostId: string;
    servingIdNamespace: string;
    modelIdNamespace: string;
    featureProvenance: Record<string, unknown>;
    pipelineVersion: string;
    graphVersion: string;
    modelId: string;
    modelVersion: string;
    artifactId: string;
    artifactVersion: string;
    indexNamespace: string;
    indexId: string;
    indexVersion: string;
};

export type AnnArtifactManifestV1 = {
    manifestVersion: typeof ANN_ARTIFACT_MANIFEST_VERSION;
    mode: ArtifactMode;
    trainingReady: boolean;
    cutoff: string;
    metric: string;
    normalization: string;
    dimension: number;
    count: number;
    sha256: string;
    indexNamespace: string;
    indexId: string;
    indexVersion: string;
};

export type DatasetAcceptanceV1 = {
    acceptanceVersion: typeof DATASET_ACCEPTANCE_VERSION;
    mode: ArtifactMode;
    trainingReady: boolean;
    datasetDigest: string;
    approvedContentDigest: string | null;
    identity: TrainingArtifactIdentity;
    observed: {
        validExamples: number;
        validQueries: number;
        positiveLabels: number;
        negativeLabels: number;
        pitCoverage: number;
    };
    thresholds: {
        minValidQueries: number;
        minPositiveLabels: number;
        minNegativeLabels: number;
        minPitCoverage: number;
    } | null;
    diagnostics: string[];
};
