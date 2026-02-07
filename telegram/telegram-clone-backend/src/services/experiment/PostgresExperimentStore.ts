import ExperimentModel from '../../models/Experiment';
import type { Experiment, ExperimentStatus } from './types';
import type { ExperimentStore } from './ExperimentService';

function toExperiment(row: ExperimentModel): Experiment {
    const data = row.get({ plain: true }) as any;
    return {
        id: String(data.id),
        name: String(data.name),
        description: data.description ?? undefined,
        status: data.status as ExperimentStatus,
        bucketingType: data.bucketingType,
        buckets: Array.isArray(data.buckets) ? data.buckets : [],
        targetAudience: data.targetAudience ?? undefined,
        trafficPercent: Number(data.trafficPercent ?? 0),
        startDate: data.startDate ?? undefined,
        endDate: data.endDate ?? undefined,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        createdBy: data.createdBy ?? undefined,
        metrics: Array.isArray(data.metrics) ? data.metrics : undefined,
        tags: Array.isArray(data.tags) ? data.tags : undefined,
    };
}

export class PostgresExperimentStore implements ExperimentStore {
    async getExperiment(id: string): Promise<Experiment | null> {
        const row = await ExperimentModel.findByPk(id);
        if (!row) return null;
        return toExperiment(row);
    }

    async listExperiments(status?: ExperimentStatus): Promise<Experiment[]> {
        const rows = await ExperimentModel.findAll({
            where: status ? ({ status } as any) : undefined,
            order: [['updatedAt', 'DESC']],
        });
        return rows.map(toExperiment);
    }

    async saveExperiment(experiment: Experiment): Promise<void> {
        await ExperimentModel.upsert({
            ...experiment,
        } as any);
    }

    async deleteExperiment(id: string): Promise<void> {
        await ExperimentModel.destroy({ where: { id } as any });
    }
}

export default PostgresExperimentStore;

