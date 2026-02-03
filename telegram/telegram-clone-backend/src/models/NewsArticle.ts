import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/sequelize';

export interface NewsArticleAttributes {
  id: string;
  title: string;
  summary: string;
  lead?: string | null;
  source: string;
  sourceUrl?: string | null;
  canonicalUrl?: string | null;
  publishedAt?: Date | null;
  fetchedAt?: Date;
  language?: string | null;
  country?: string | null;
  category?: string | null;
  coverImageUrl?: string | null;
  contentPath?: string | null;
  hashUrl: string;
  clusterId?: number | null;
  isActive?: boolean;
  deletedAt?: Date | null;
  keywords?: string[] | null;
  engagementScore?: number;
  viewCount?: number;
  clickCount?: number;
  shareCount?: number;
  dwellCount?: number;
  embedding?: number[] | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface NewsArticleCreationAttributes extends Optional<NewsArticleAttributes, 'id' | 'lead' | 'sourceUrl' | 'canonicalUrl' | 'publishedAt' | 'fetchedAt' | 'language' | 'country' | 'category' | 'coverImageUrl' | 'contentPath' | 'clusterId' | 'isActive' | 'deletedAt' | 'keywords' | 'engagementScore' | 'viewCount' | 'clickCount' | 'shareCount' | 'dwellCount' | 'embedding' | 'createdAt' | 'updatedAt'> {}

class NewsArticle extends Model<NewsArticleAttributes, NewsArticleCreationAttributes> implements NewsArticleAttributes {
  public id!: string;
  public title!: string;
  public summary!: string;
  public lead?: string | null;
  public source!: string;
  public sourceUrl?: string | null;
  public canonicalUrl?: string | null;
  public publishedAt?: Date | null;
  public fetchedAt?: Date;
  public language?: string | null;
  public country?: string | null;
  public category?: string | null;
  public coverImageUrl?: string | null;
  public contentPath?: string | null;
  public hashUrl!: string;
  public clusterId?: number | null;
  public isActive?: boolean;
  public deletedAt?: Date | null;
  public keywords?: string[] | null;
  public engagementScore?: number;
  public viewCount?: number;
  public clickCount?: number;
  public shareCount?: number;
  public dwellCount?: number;
  public embedding?: number[] | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

NewsArticle.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    title: {
      type: DataTypes.STRING(512),
      allowNull: false,
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    lead: {
      type: DataTypes.STRING(1024),
      allowNull: true,
    },
    source: {
      type: DataTypes.STRING(120),
      allowNull: false,
    },
    sourceUrl: {
      type: DataTypes.STRING(1024),
      allowNull: true,
    },
    canonicalUrl: {
      type: DataTypes.STRING(1024),
      allowNull: true,
    },
    publishedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    fetchedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    language: {
      type: DataTypes.STRING(12),
      allowNull: true,
    },
    country: {
      type: DataTypes.STRING(32),
      allowNull: true,
    },
    category: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    coverImageUrl: {
      type: DataTypes.STRING(1024),
      allowNull: true,
    },
    contentPath: {
      type: DataTypes.STRING(1024),
      allowNull: true,
    },
    hashUrl: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true,
    },
    clusterId: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    keywords: {
      type: DataTypes.ARRAY(DataTypes.TEXT),
      allowNull: true,
    },
    engagementScore: {
      type: DataTypes.FLOAT,
      allowNull: false,
      defaultValue: 0,
    },
    viewCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    clickCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    shareCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    dwellCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    embedding: {
      type: DataTypes.ARRAY(DataTypes.FLOAT),
      allowNull: true,
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'NewsArticle',
    tableName: 'news_articles',
    timestamps: true,
    paranoid: true,
    indexes: [
      { unique: true, fields: ['hashUrl'] },
      { fields: ['publishedAt'] },
      { fields: ['source'] },
      { fields: ['clusterId'] },
      { fields: ['isActive'] },
    ],
  }
);

export default NewsArticle;
