import { DataTypes, Model, Optional, Op } from 'sequelize';
import { sequelize } from '../config/sequelize';
import bcrypt from 'bcryptjs';

// 用户属性接口
export interface UserAttributes {
  id: string;
  username: string;
  password: string;
  email?: string;
  avatarUrl?: string;
  lastSeen?: Date;
  isOnline?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

// 创建用户时的可选属性
interface UserCreationAttributes extends Optional<UserAttributes, 'id' | 'createdAt' | 'updatedAt' | 'email' | 'avatarUrl'> {}

// 用户模型类
class User extends Model<UserAttributes, UserCreationAttributes> implements UserAttributes {
  public id!: string;
  public username!: string;
  public password!: string;
  public email?: string;
  public avatarUrl?: string;
  public lastSeen?: Date;
  public isOnline?: boolean;
  
  // 时间戳
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;

  // 实例方法：验证密码
  public async validatePassword(password: string): Promise<boolean> {
    return await bcrypt.compare(password, this.password);
  }

  // 实例方法：获取用户的公开信息（不包含密码）
  public toJSON(): Omit<UserAttributes, 'password'> {
    const values = Object.assign({}, this.get()) as UserAttributes;
    const { password, ...publicValues } = values;
    return publicValues;
  }
}

// 定义用户模型
User.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    username: {
      type: DataTypes.STRING(50),
      allowNull: false,
      unique: true,
      validate: {
        len: [3, 50],
        notEmpty: true,
        is: /^[a-zA-Z0-9_]+$/, // 只允许字母、数字和下划线
      },
    },
    password: {
      type: DataTypes.STRING(255),
      allowNull: false,
      validate: {
        len: [6, 255],
        notEmpty: true,
      },
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    avatarUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      validate: {
        isUrl: true,
      },
    },
    lastSeen: {
      type: DataTypes.DATE,
      allowNull: true,
      defaultValue: DataTypes.NOW,
    },
    isOnline: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
  },
  {
    sequelize,
    modelName: 'User',
    tableName: 'users',
    timestamps: true,
    indexes: [
      {
        unique: true,
        fields: ['username'],
      },
      {
        unique: true,
        fields: ['email'],
        where: {
          email: {
            [Op.ne]: null,
          },
        },
      },
    ],
    hooks: {
      // 保存前自动加密密码
      beforeCreate: async (user: User) => {
        if (user.password) {
          const saltRounds = 12;
          user.password = await bcrypt.hash(user.password, saltRounds);
        }
      },
      beforeUpdate: async (user: User) => {
        if (user.changed('password')) {
          const saltRounds = 12;
          user.password = await bcrypt.hash(user.password, saltRounds);
        }
      },
    },
  }
);

export default User;
