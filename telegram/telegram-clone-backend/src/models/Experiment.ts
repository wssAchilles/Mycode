import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/sequelize';

export interface ExperimentAttributes {
    id: string;
    name: string;
    description?: string | null;
    status: string;
    bucketingType: string;
    buckets: any[];
    targetAudience?: Record<string, any> | null;
    trafficPercent: number;
    startDate?: Date | null;
    endDate?: Date | null;
    createdBy?: string | null;
    metrics?: string[] | null;
    tags?: string[] | null;
    createdAt?: Date;
    updatedAt?: Date;
}

interface ExperimentCreationAttributes
    extends Optional<
        ExperimentAttributes,
        | 'description'
        | 'targetAudience'
        | 'startDate'
        | 'endDate'
        | 'createdBy'
        | 'metrics'
        | 'tags'
        | 'createdAt'
        | 'updatedAt'
    > {}

class Experiment extends Model<ExperimentAttributes, ExperimentCreationAttributes> implements ExperimentAttributes {
    public id!: string;
    public name!: string;
    public description?: string | null;
    public status!: string;
    public bucketingType!: string;
    public buckets!: any[];
    public targetAudience?: Record<string, any> | null;
    public trafficPercent!: number;
    public startDate?: Date | null;
    public endDate?: Date | null;
    public createdBy?: string | null;
    public metrics?: string[] | null;
    public tags?: string[] | null;

    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

Experiment.init(
    {
        id: {
            type: DataTypes.STRING(128),
            primaryKey: true,
        },
        name: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        description: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        status: {
            type: DataTypes.STRING(32),
            allowNull: false,
            defaultValue: 'draft',
        },
        bucketingType: {
            type: DataTypes.STRING(32),
            allowNull: false,
            defaultValue: 'user',
        },
        buckets: {
            type: DataTypes.JSONB,
            allowNull: false,
            defaultValue: [],
        },
        targetAudience: {
            type: DataTypes.JSONB,
            allowNull: true,
        },
        trafficPercent: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
        },
        startDate: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        endDate: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        createdBy: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        metrics: {
            type: DataTypes.JSONB,
            allowNull: true,
        },
        tags: {
            type: DataTypes.JSONB,
            allowNull: true,
        },
    },
    {
        sequelize,
        modelName: 'Experiment',
        tableName: 'experiments',
        timestamps: true,
        indexes: [
            { fields: ['status'] },
        ],
    }
);

export default Experiment;

