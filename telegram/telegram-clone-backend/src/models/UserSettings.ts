/**
 * UserSettings - 用户设置模型
 * 存储用户的个性化设置，包括静音关键词、通知偏好等
 */

import mongoose, { Schema, Document } from 'mongoose';

/**
 * 用户设置接口
 */
export interface IUserSettings extends Document {
    userId: string;
    
    // 静音设置
    mutedKeywords: string[];
    mutedUserIds: string[];
    
    // 通知偏好
    notificationSettings: {
        likes: boolean;
        replies: boolean;
        reposts: boolean;
        mentions: boolean;
        newFollowers: boolean;
        directMessages: boolean;
    };
    
    // Feed 偏好
    feedSettings: {
        showReplies: boolean;
        showReposts: boolean;
        preferInNetwork: boolean;  // 优先显示关注网络内容
        sensitiveContentFilter: boolean;
    };
    
    // 隐私设置
    privacySettings: {
        allowDirectMessages: 'everyone' | 'followers' | 'none';
        showOnlineStatus: boolean;
        showReadReceipts: boolean;
    };
    
    createdAt: Date;
    updatedAt: Date;
}

const UserSettingsSchema = new Schema<IUserSettings>(
    {
        userId: {
            type: String,
            required: true,
            unique: true,
            index: true,
        },
        
        // 静音设置
        mutedKeywords: {
            type: [String],
            default: [],
        },
        mutedUserIds: {
            type: [String],
            default: [],
        },
        
        // 通知偏好
        notificationSettings: {
            likes: { type: Boolean, default: true },
            replies: { type: Boolean, default: true },
            reposts: { type: Boolean, default: true },
            mentions: { type: Boolean, default: true },
            newFollowers: { type: Boolean, default: true },
            directMessages: { type: Boolean, default: true },
        },
        
        // Feed 偏好
        feedSettings: {
            showReplies: { type: Boolean, default: true },
            showReposts: { type: Boolean, default: true },
            preferInNetwork: { type: Boolean, default: false },
            sensitiveContentFilter: { type: Boolean, default: true },
        },
        
        // 隐私设置
        privacySettings: {
            allowDirectMessages: {
                type: String,
                enum: ['everyone', 'followers', 'none'],
                default: 'everyone',
            },
            showOnlineStatus: { type: Boolean, default: true },
            showReadReceipts: { type: Boolean, default: true },
        },
    },
    {
        timestamps: true,
    }
);

// 静态方法: 获取或创建用户设置
UserSettingsSchema.statics.getOrCreate = async function (
    userId: string
): Promise<IUserSettings> {
    let settings = await this.findOne({ userId });
    if (!settings) {
        settings = await this.create({ userId });
    }
    return settings;
};

// 静态方法: 获取静音关键词
UserSettingsSchema.statics.getMutedKeywords = async function (
    userId: string
): Promise<string[]> {
    const settings = await this.findOne({ userId }).select('mutedKeywords');
    return settings?.mutedKeywords || [];
};

// 静态方法: 添加静音关键词
UserSettingsSchema.statics.addMutedKeyword = async function (
    userId: string,
    keyword: string
): Promise<void> {
    await this.updateOne(
        { userId },
        { $addToSet: { mutedKeywords: keyword.toLowerCase() } },
        { upsert: true }
    );
};

// 静态方法: 移除静音关键词
UserSettingsSchema.statics.removeMutedKeyword = async function (
    userId: string,
    keyword: string
): Promise<void> {
    await this.updateOne(
        { userId },
        { $pull: { mutedKeywords: keyword.toLowerCase() } }
    );
};

// 静态方法: 获取静音用户列表
UserSettingsSchema.statics.getMutedUserIds = async function (
    userId: string
): Promise<string[]> {
    const settings = await this.findOne({ userId }).select('mutedUserIds');
    return settings?.mutedUserIds || [];
};

// 添加类型声明
interface UserSettingsModel extends mongoose.Model<IUserSettings> {
    getOrCreate(userId: string): Promise<IUserSettings>;
    getMutedKeywords(userId: string): Promise<string[]>;
    addMutedKeyword(userId: string, keyword: string): Promise<void>;
    removeMutedKeyword(userId: string, keyword: string): Promise<void>;
    getMutedUserIds(userId: string): Promise<string[]>;
}

export default mongoose.model<IUserSettings, UserSettingsModel>(
    'UserSettings',
    UserSettingsSchema
);
