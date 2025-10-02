import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/sequelize';

// 群组成员角色枚举
export enum MemberRole {
  OWNER = 'owner',         // 群主
  ADMIN = 'admin',         // 管理员
  MEMBER = 'member'        // 普通成员
}

// 群组成员状态枚举
export enum MemberStatus {
  ACTIVE = 'active',       // 活跃成员
  MUTED = 'muted',         // 被禁言
  BANNED = 'banned',       // 被踢出
  LEFT = 'left'            // 主动退出
}

// 群组成员接口
export interface IGroupMember {
  id: string;
  groupId: string;         // 群组 ID
  userId: string;          // 用户 ID
  role: MemberRole;        // 成员角色
  status: MemberStatus;    // 成员状态
  nickname?: string;       // 群内昵称
  joinedAt: Date;          // 加入时间
  mutedUntil?: Date;       // 禁言到期时间
  invitedBy?: string;      // 邀请者用户 ID
  isActive: boolean;       // 是否活跃
  lastSeenAt?: Date;       // 最后查看消息时间
  createdAt: Date;         // 创建时间
  updatedAt: Date;         // 更新时间
}

// 创建接口（可选字段）
interface GroupMemberCreationAttributes extends Optional<IGroupMember, 'id' | 'nickname' | 'mutedUntil' | 'invitedBy' | 'isActive' | 'lastSeenAt' | 'joinedAt' | 'createdAt' | 'updatedAt'> {}

// 扩展 GroupMember 模型类，添加静态和实例方法
interface GroupMemberModel {
  getGroupMembers(groupId: string, includeInactive?: boolean): Promise<GroupMember[]>;
  getUserGroups(userId: string): Promise<GroupMember[]>;
  isMember(groupId: string, userId: string): Promise<boolean>;
  hasPermission(groupId: string, userId: string, requiredRole?: MemberRole): Promise<boolean>;
}

interface GroupMemberInstance {
  promoteToAdmin(): Promise<GroupMember>;
  demoteToMember(): Promise<GroupMember>;
  mute(duration?: number): Promise<GroupMember>;
  unmute(): Promise<GroupMember>;
  ban(): Promise<GroupMember>;
  leave(): Promise<GroupMember>;
  updateLastSeen(): Promise<GroupMember>;
  isMuted(): boolean;
}

// 群组成员模型类
class GroupMember extends Model<IGroupMember, GroupMemberCreationAttributes> implements IGroupMember, GroupMemberInstance {
  public id!: string;
  public groupId!: string;
  public userId!: string;
  public role!: MemberRole;
  public status!: MemberStatus;
  public nickname?: string;
  public joinedAt!: Date;
  public mutedUntil?: Date;
  public invitedBy?: string;
  public isActive!: boolean;
  public lastSeenAt?: Date;
  public createdAt!: Date;
  public updatedAt!: Date;

  // 关联
  public readonly User?: any;
  public readonly Group?: any;
  public readonly Inviter?: any;

  // 静态方法
  static getGroupMembers: (groupId: string, includeInactive?: boolean) => Promise<GroupMember[]>;
  static getUserGroups: (userId: string) => Promise<GroupMember[]>;
  static isMember: (groupId: string, userId: string) => Promise<boolean>;
  static hasPermission: (groupId: string, userId: string, requiredRole?: MemberRole) => Promise<boolean>;

  // 实例方法
  async promoteToAdmin(): Promise<GroupMember> {
    if (this.role === MemberRole.MEMBER) {
      this.role = MemberRole.ADMIN;
      await this.save();
    }
    return this;
  }

  async demoteToMember(): Promise<GroupMember> {
    if (this.role === MemberRole.ADMIN) {
      this.role = MemberRole.MEMBER;
      await this.save();
    }
    return this;
  }

  async mute(duration: number = 24): Promise<GroupMember> {
    this.status = MemberStatus.MUTED;
    this.mutedUntil = new Date(Date.now() + duration * 60 * 60 * 1000);
    await this.save();
    return this;
  }

  async unmute(): Promise<GroupMember> {
    this.status = MemberStatus.ACTIVE;
    this.mutedUntil = undefined;
    await this.save();
    return this;
  }

  async ban(): Promise<GroupMember> {
    this.status = MemberStatus.BANNED;
    this.isActive = false;
    await this.save();
    return this;
  }

  async leave(): Promise<GroupMember> {
    this.status = MemberStatus.LEFT;
    this.isActive = false;
    await this.save();
    return this;
  }

  async updateLastSeen(): Promise<GroupMember> {
    this.lastSeenAt = new Date();
    await this.save();
    return this;
  }

  isMuted(): boolean {
    if (this.status !== MemberStatus.MUTED || !this.mutedUntil) {
      return false;
    }
    return new Date() < this.mutedUntil;
  }
}

// 定义群组成员模型
GroupMember.init({
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  groupId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'groups',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    field: 'group_id'
  },
  userId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    },
    onUpdate: 'CASCADE',
    onDelete: 'CASCADE',
    field: 'user_id'
  },
  role: {
    type: DataTypes.ENUM(...Object.values(MemberRole)),
    allowNull: false,
    defaultValue: MemberRole.MEMBER
  },
  status: {
    type: DataTypes.ENUM(...Object.values(MemberStatus)),
    allowNull: false,
    defaultValue: MemberStatus.ACTIVE
  },
  nickname: {
    type: DataTypes.STRING(50),
    allowNull: true,
    validate: {
      len: [1, 50]
    }
  },
  joinedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW,
    field: 'joined_at'
  },
  mutedUntil: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'muted_until'
  },
  invitedBy: {
    type: DataTypes.UUID,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    },
    field: 'invited_by'
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'is_active'
  },
  lastSeenAt: {
    type: DataTypes.DATE,
    allowNull: true,
    field: 'last_seen_at'
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
  modelName: 'GroupMember',
  tableName: 'group_members',
  timestamps: true,
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  indexes: [
    {
      unique: true,
      fields: ['group_id', 'user_id']
    },
    {
      fields: ['group_id']
    },
    {
      fields: ['user_id']
    },
    {
      fields: ['role']
    },
    {
      fields: ['status']
    },
    {
      fields: ['is_active']
    }
  ]
});

// 静态方法实现
GroupMember.getGroupMembers = async function(groupId: string, includeInactive: boolean = false): Promise<GroupMember[]> {
  const where: any = {
    groupId,
    status: MemberStatus.ACTIVE
  };
  
  if (!includeInactive) {
    where.isActive = true;
  }
  
  return await GroupMember.findAll({
    where,
    include: [
      {
        model: sequelize.models.User,
        as: 'User',
        attributes: ['id', 'username', 'email', 'avatarUrl']
      }
    ],
    order: [
      ['role', 'ASC'],
      ['joinedAt', 'ASC']
    ]
  });
};

GroupMember.getUserGroups = async function(userId: string): Promise<GroupMember[]> {
  return await GroupMember.findAll({
    where: {
      userId,
      status: MemberStatus.ACTIVE,
      isActive: true
    },
    include: [
      {
        model: sequelize.models.Group,
        as: 'Group',
        where: {
          isActive: true
        },
        attributes: ['id', 'name', 'description', 'type', 'avatarUrl', 'memberCount']
      }
    ],
    order: [['joinedAt', 'DESC']]
  });
};

GroupMember.isMember = async function(groupId: string, userId: string): Promise<boolean> {
  const member = await GroupMember.findOne({
    where: {
      groupId,
      userId,
      status: MemberStatus.ACTIVE,
      isActive: true
    }
  });
  return !!member;
};

GroupMember.hasPermission = async function(groupId: string, userId: string, requiredRole: MemberRole = MemberRole.MEMBER): Promise<boolean> {
  const member = await GroupMember.findOne({
    where: {
      groupId,
      userId,
      status: MemberStatus.ACTIVE,
      isActive: true
    }
  });
  
  if (!member) return false;
  
  const roleLevel = {
    [MemberRole.OWNER]: 3,
    [MemberRole.ADMIN]: 2,
    [MemberRole.MEMBER]: 1
  };
  
  return roleLevel[member.role] >= roleLevel[requiredRole];
};

export default GroupMember;
