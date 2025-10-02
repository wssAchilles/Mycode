import mongoose, { Schema, Document } from 'mongoose';
import bcrypt from 'bcryptjs';

// 用户属性接口
export interface IUserMongo extends Document {
  _id: mongoose.Types.ObjectId;
  username: string;
  password: string;
  email?: string;
  avatarUrl?: string;
  createdAt: Date;
  updatedAt: Date;
  
  // 实例方法
  validatePassword(password: string): Promise<boolean>;
  toJSON(): any;
}

// 用户 Schema
const UserMongoSchema: Schema = new Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 50,
    match: /^[a-zA-Z0-9_]+$/
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
    maxlength: 255
  },
  email: {
    type: String,
    unique: true,
    sparse: true, // 允许多个文档具有 null 值，但唯一值必须唯一
    trim: true,
    lowercase: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  avatarUrl: {
    type: String,
    default: null
  }
}, {
  timestamps: true, // 自动添加 createdAt 和 updatedAt
  collection: 'users'
});

// 保存前加密密码
UserMongoSchema.pre('save', async function(next) {
  // 如果密码没有被修改，跳过加密
  if (!this.isModified('password')) {
    return next();
  }

  try {
    // 确保 password 是字符串类型
    const password = this.password as string;
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(password, salt);
    next();
  } catch (error) {
    next(error as Error);
  }
});

// 实例方法：验证密码
UserMongoSchema.methods.validatePassword = async function(password: string): Promise<boolean> {
  return await bcrypt.compare(password, this.password);
};

// 转换为 JSON 时移除敏感信息
UserMongoSchema.methods.toJSON = function() {
  const userObject = this.toObject();
  
  // 创建一个新对象，确保可以安全地删除属性
  const ret: any = {
    id: userObject._id,
    username: userObject.username,
    email: userObject.email,
    avatarUrl: userObject.avatarUrl,
    createdAt: userObject.createdAt,
    updatedAt: userObject.updatedAt
  };

  // 删除敏感信息（这些属性现在是可选的）
  delete ret.password;
  delete ret._id;
  delete ret.__v;

  return ret;
};

// 创建索引
UserMongoSchema.index({ username: 1 });
UserMongoSchema.index({ email: 1 }, { sparse: true });

const UserMongo = mongoose.model<IUserMongo>('User', UserMongoSchema);

export default UserMongo;
