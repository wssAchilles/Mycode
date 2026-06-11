import mongoose, { Document, Model, Schema } from 'mongoose';

export type RecommendationJobStatus = 'running' | 'success' | 'failed';

export interface IRecommendationJobRun extends Document {
    jobName: string;
    status: RecommendationJobStatus;
    startedAt: Date;
    finishedAt?: Date;
    durationMs?: number;
    trigger: 'cron' | 'manual' | 'script';
    releaseTag?: string;
    summary: Record<string, unknown>;
    error?: string;
}

const RecommendationJobRunSchema = new Schema<IRecommendationJobRun>(
    {
        jobName: {
            type: String,
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: ['running', 'success', 'failed'],
            required: true,
            index: true,
        },
        startedAt: {
            type: Date,
            required: true,
            default: Date.now,
            index: true,
        },
        finishedAt: Date,
        durationMs: Number,
        trigger: {
            type: String,
            enum: ['cron', 'manual', 'script'],
            required: true,
            default: 'cron',
            index: true,
        },
        releaseTag: String,
        summary: {
            type: Schema.Types.Mixed,
            default: {},
        },
        error: String,
    },
    {
        collection: 'recommendation_job_runs',
        timestamps: true,
    },
);

RecommendationJobRunSchema.index({ jobName: 1, startedAt: -1 });
RecommendationJobRunSchema.index({ status: 1, startedAt: -1 });

const RecommendationJobRun = mongoose.model<IRecommendationJobRun, Model<IRecommendationJobRun>>(
    'RecommendationJobRun',
    RecommendationJobRunSchema,
);

export default RecommendationJobRun;
