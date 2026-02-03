import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/sequelize';

export interface NewsUserVectorAttributes {
  id: string;
  userId: string;
  shortTermVector?: Record<string, number> | null;
  longTermVector?: Record<string, number> | null;
  updatedAt?: Date;
  createdAt?: Date;
}

interface NewsUserVectorCreationAttributes extends Optional<NewsUserVectorAttributes, 'id' | 'shortTermVector' | 'longTermVector' | 'updatedAt' | 'createdAt'> {}

class NewsUserVector extends Model<NewsUserVectorAttributes, NewsUserVectorCreationAttributes> implements NewsUserVectorAttributes {
  public id!: string;
  public userId!: string;
  public shortTermVector?: Record<string, number> | null;
  public longTermVector?: Record<string, number> | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

NewsUserVector.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true,
    },
    shortTermVector: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
    longTermVector: {
      type: DataTypes.JSONB,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'NewsUserVector',
    tableName: 'news_user_vectors',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['userId'] },
    ],
  }
);

export default NewsUserVector;
