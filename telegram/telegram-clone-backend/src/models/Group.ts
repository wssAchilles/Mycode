import { DataTypes, Model, Optional, Op } from 'sequelize';
import { sequelize } from '../config/sequelize';

// 群组类型枚举
export enum GroupType {
  PUBLIC = 'public',     // 公开群组
  PRIVATE = 'private'    // 私有群组
}

// 群组接口
export interface IGroup {
  id: string;
  name: string;           // 群组名称
  description?: string;   // 群组描述
  ownerId: string;        // 群主用户 ID
  type: GroupType;        // 群组类型
  avatarUrl?: string;     // 群组头像
  maxMembers: number;     // 最大成员数
  memberCount: number;    // 当前成员数
  isActive: boolean;      // 是否活跃
  createdAt: Date;        // 创建时间
  updatedAt: Date;        // 更新时间
}

// 创建接口（可选字段）
interface GroupCreationAttributes extends Optional<IGroup, 'id' | 'description' | 'avatarUrl' | 'maxMembers' | 'memberCount' | 'isActive' | 'createdAt' | 'updatedAt'> {}

// 群组实例方法接口
interface GroupInstanceMethods {
  isFull(): boolean;
  updateMemberCount(): Promise<Group>;
}

// 群组静态方法接口
interface GroupStaticMethods {
  getByOwnerId(ownerId: string): Promise<Group[]>;
  searchPublicGroups(keyword: string, limit?: number): Promise<Group[]>;
}

// 群组模型类
class Group extends Model<IGroup, GroupCreationAttributes> implements IGroup, GroupInstanceMethods {
  public id!: string;
  public name!: string;
  public description?: string;
  public ownerId!: string;
  public type!: GroupType;
  public avatarUrl?: string;
  public maxMembers!: number;
  public memberCount!: number;
  public isActive!: boolean;
  public createdAt!: Date;
  public updatedAt!: Date;

  // 关联
  public readonly Owner?: any;
  public readonly Members?: any[];

  // 静态方法
  static getByOwnerId: (ownerId: string) => Promise<Group[]>;
  static searchPublicGroups: (keyword: string, limit?: number) => Promise<Group[]>;

  // 实例方法：检查群组是否已满
  isFull(): boolean {
    return this.memberCount >= this.maxMembers;
  }

  // 实例方法：更新成员数量
  async updateMemberCount(): Promise<Group> {
    const { sequelize } = require('../config/sequelize');
    const count = await sequelize.models.GroupMember.count({
      where: {
        groupId: this.id,
        status: 'active',
        isActive: true
      }
    });
    this.memberCount = count;
    await this.save();
    return this;
  }
}

// 定义群组模型
Group.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      len: [1, 100],
      notEmpty: true
    }
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true,
    validate: {
      len: [0, 500]
    }
  },
  ownerId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    field: 'owner_id'
  },
  type: {
    type: DataTypes.ENUM(...Object.values(GroupType)),
    allowNull: false,
    defaultValue: GroupType.PRIVATE
  },
  avatarUrl: {
    type: DataTypes.STRING(500),
    allowNull: true,
    field: 'avatar_url',
    validate: {
      isUrl: true
    }
  },
  maxMembers: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 200,
    field: 'max_members',
    validate: {
      min: 2,
      max: 1000
    }
  },
  memberCount: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 1, // 创建者自动成为成员
    field: 'member_count',
    validate: {
      min: 0
    }
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'is_active'
  },
  createdAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'created_at'
  },
  updatedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'updated_at'
  }
}, {
  sequelize,
  modelName: 'Group',
  tableName: 'groups',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [
    // 群主索引
    {
      fields: ['owner_id']
    },
    // 群组类型索引
    {
      fields: ['type']
    },
    // 活跃状态索引
    {
      fields: ['is_active']
    },
    // 名称索引（用于搜索）
    {
      fields: ['name']
    }
  ]
});

// 静态方法实现
Group.getByOwnerId = async function(userId: string): Promise<Group[]> {
  return await Group.findAll({
    where: {
      ownerId: userId,
      isActive: true
    },
    order: [['createdAt', 'DESC']]
  });
};

Group.searchPublicGroups = async function(keyword: string, limit: number = 20): Promise<Group[]> {
  return await Group.findAll({
    where: {
      type: GroupType.PUBLIC,
      isActive: true,
      name: {
        [Op.iLike]: `%${keyword}%`
      }
    },
    limit,
    order: [['memberCount', 'DESC'], ['createdAt', 'DESC']]
  });
};

export default Group;
