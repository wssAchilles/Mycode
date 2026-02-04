import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/sequelize';

export interface NewsSourceAttributes {
  id: string;
  name: string;
  baseUrl?: string | null;
  rssUrl?: string | null;
  trustLevel?: number;
  language?: string | null;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

interface NewsSourceCreationAttributes extends Optional<NewsSourceAttributes, 'id' | 'baseUrl' | 'rssUrl' | 'trustLevel' | 'language' | 'isActive' | 'createdAt' | 'updatedAt'> {}

class NewsSource extends Model<NewsSourceAttributes, NewsSourceCreationAttributes> implements NewsSourceAttributes {
  public id!: string;
  public name!: string;
  public baseUrl?: string | null;
  public rssUrl?: string | null;
  public trustLevel?: number;
  public language?: string | null;
  public isActive?: boolean;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

NewsSource.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(120),
      allowNull: false,
      unique: true,
    },
    baseUrl: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },
    rssUrl: {
      type: DataTypes.STRING(1024),
      allowNull: true,
    },
    trustLevel: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 5,
    },
    language: {
      type: DataTypes.STRING(12),
      allowNull: true,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
  },
  {
    sequelize,
    modelName: 'NewsSource',
    tableName: 'news_sources',
    timestamps: true,
    indexes: [
      { unique: true, fields: ['name'] },
      { fields: ['trustLevel'] },
      { fields: ['isActive'] },
    ],
  }
);

export default NewsSource;
