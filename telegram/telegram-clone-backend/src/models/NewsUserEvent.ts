import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/sequelize';

export type NewsEventType = 'impression' | 'click' | 'dwell' | 'share';

export interface NewsUserEventAttributes {
  id: string;
  userId: string;
  newsId: string;
  eventType: NewsEventType;
  dwellMs?: number | null;
  createdAt?: Date;
  updatedAt?: Date;
}

interface NewsUserEventCreationAttributes extends Optional<NewsUserEventAttributes, 'id' | 'dwellMs' | 'createdAt' | 'updatedAt'> {}

class NewsUserEvent extends Model<NewsUserEventAttributes, NewsUserEventCreationAttributes> implements NewsUserEventAttributes {
  public id!: string;
  public userId!: string;
  public newsId!: string;
  public eventType!: NewsEventType;
  public dwellMs?: number | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

NewsUserEvent.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    newsId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    eventType: {
      type: DataTypes.ENUM('impression', 'click', 'dwell', 'share'),
      allowNull: false,
    },
    dwellMs: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
  },
  {
    sequelize,
    modelName: 'NewsUserEvent',
    tableName: 'news_user_events',
    timestamps: true,
    indexes: [
      { fields: ['userId'] },
      { fields: ['newsId'] },
      { fields: ['eventType'] },
      { fields: ['createdAt'] },
    ],
  }
);

export default NewsUserEvent;
