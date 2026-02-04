/**
 * UserKey 模型 - 用户 Signal Protocol 公钥包
 * 存储用户的 Identity Key 和 Signed PreKey
 */
import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/sequelize';

// 用户密钥接口
export interface IUserKey {
    id: string;
    userId: string;
    registrationId: number;        // Signal 注册 ID (32-bit)
    identityKey: string;           // Base64 编码的 Identity Public Key
    signedPreKeyId: number;        // Signed PreKey ID
    signedPreKey: string;          // Base64 编码的 Signed PreKey Public Key
    signedPreKeySig: string;       // Base64 编码的签名
    createdAt: Date;
    updatedAt: Date;
}

// 创建接口
interface UserKeyCreationAttributes extends Optional<IUserKey, 'id' | 'createdAt' | 'updatedAt'> { }

// UserKey 模型类
class UserKey extends Model<IUserKey, UserKeyCreationAttributes> implements IUserKey {
    public id!: string;
    public userId!: string;
    public registrationId!: number;
    public identityKey!: string;
    public signedPreKeyId!: number;
    public signedPreKey!: string;
    public signedPreKeySig!: string;
    public createdAt!: Date;
    public updatedAt!: Date;
}

// 定义 UserKey 模型
UserKey.init({
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        unique: true,
        references: {
            model: 'users',
            key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        field: 'user_id',
    },
    registrationId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'registration_id',
        comment: 'Signal Protocol 32-bit 注册 ID',
    },
    identityKey: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'identity_key',
        comment: 'Base64 编码的 Identity Public Key',
    },
    signedPreKeyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'signed_pre_key_id',
        comment: 'Signed PreKey 的 ID',
    },
    signedPreKey: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'signed_pre_key',
        comment: 'Base64 编码的 Signed PreKey Public Key',
    },
    signedPreKeySig: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'signed_pre_key_sig',
        comment: 'Signed PreKey 的 Ed25519 签名',
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
    },
    updatedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'updated_at',
    },
}, {
    sequelize,
    modelName: 'UserKey',
    tableName: 'user_keys',
    timestamps: true,
    indexes: [
        {
            unique: true,
            fields: ['user_id'],
        },
    ],
});

export default UserKey;
