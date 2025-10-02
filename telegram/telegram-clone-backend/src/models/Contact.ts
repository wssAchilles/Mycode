import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/sequelize';

// 联系人状态枚举
export enum ContactStatus {
  PENDING = 'pending',     // 待确认
  ACCEPTED = 'accepted',   // 已接受
  BLOCKED = 'blocked',     // 已屏蔽
  REJECTED = 'rejected'    // 已拒绝
}

// 联系人接口
export interface IContact {
  id: string;
  userId: string;          // 发起者用户 ID
  contactId: string;       // 联系人用户 ID
  status: ContactStatus;   // 联系人状态
  alias?: string;          // 联系人备注名
  addedAt: Date;           // 添加时间
  updatedAt: Date;         // 更新时间
}

// 创建接口（可选字段）
interface ContactCreationAttributes extends Optional<IContact, 'id' | 'alias' | 'addedAt' | 'updatedAt'> {}

// 联系人模型类
class Contact extends Model<IContact, ContactCreationAttributes> implements IContact {
  public id!: string;
  public userId!: string;
  public contactId!: string;
  public status!: ContactStatus;
  public alias?: string;
  public addedAt!: Date;
  public updatedAt!: Date;

  // 实例方法：接受联系人请求
  async accept(): Promise<Contact> {
    this.status = ContactStatus.ACCEPTED;
    await this.save();
    
    // 创建反向关系（双向联系人）
    await Contact.findOrCreate({
      where: {
        userId: this.contactId,
        contactId: this.userId
      },
      defaults: {
        userId: this.contactId,
        contactId: this.userId,
        status: ContactStatus.ACCEPTED
      }
    });
    
    return this;
  }

  // 实例方法：拒绝联系人请求
  async reject(): Promise<Contact> {
    this.status = ContactStatus.REJECTED;
    return await this.save();
  }

  // 实例方法：屏蔽联系人
  async block(): Promise<Contact> {
    this.status = ContactStatus.BLOCKED;
    return await this.save();
  }
}

// 定义联系人模型
Contact.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  },
  contactId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE'
  },
  status: {
    type: DataTypes.ENUM(...Object.values(ContactStatus)),
    allowNull: false,
    defaultValue: ContactStatus.PENDING
  },
  alias: {
    type: DataTypes.STRING(100),
    allowNull: true,
    comment: '联系人备注名'
  },
  addedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'added_at'
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'updated_at'
  }
}, {
  sequelize,
  modelName: 'Contact',
  tableName: 'contacts',
  timestamps: true,
  createdAt: 'addedAt',
  updatedAt: 'updatedAt',
  indexes: [
    // 复合索引：用户ID + 联系人ID（确保唯一性）
    {
      unique: true,
      fields: ['userId', 'contactId']
    },
    // 用户ID 索引（查询用户的所有联系人）
    {
      fields: ['userId']
    },
    // 联系人ID 索引（查询谁添加了这个用户）
    {
      fields: ['contactId']
    },
    // 状态索引（查询特定状态的联系人）
    {
      fields: ['status']
    }
  ]
});

export default Contact;
