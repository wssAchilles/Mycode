/**
 * OneTimePreKey 模型 - 一次性预密钥
 * 用于 X3DH 密钥协商，每个密钥只能使用一次
 */
import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../config/sequelize';

// 一次性预密钥接口
export interface IOneTimePreKey {
    id: string;
    userId: string;
    keyId: number;           // 密钥 ID (用于客户端关联)
    publicKey: string;       // Base64 编码的公钥
    createdAt: Date;
}

// 创建接口
interface OneTimePreKeyCreationAttributes extends Optional<IOneTimePreKey, 'id' | 'createdAt'> { }

// OneTimePreKey 模型类
class OneTimePreKey extends Model<IOneTimePreKey, OneTimePreKeyCreationAttributes> implements IOneTimePreKey {
    public id!: string;
    public userId!: string;
    public keyId!: number;
    public publicKey!: string;
    public createdAt!: Date;

    /**
     * 消费一个预密钥（获取后删除）
     */
    static async consumeKey(userId: string): Promise<IOneTimePreKey | null> {
        const key = await OneTimePreKey.findOne({
            where: { userId },
            order: [['createdAt', 'ASC']], // 优先使用最早的密钥
        });

        if (key) {
            await key.destroy();
            return key.toJSON();
        }
        return null;
    }

    /**
     * 获取用户剩余预密钥数量
     */
    static async countKeys(userId: string): Promise<number> {
        return OneTimePreKey.count({ where: { userId } });
    }

    /**
     * 批量添加预密钥
     */
    static async addKeys(
        userId: string,
        keys: Array<{ keyId: number; publicKey: string }>
    ): Promise<number> {
        const records = keys.map((k) => ({
            userId,
            keyId: k.keyId,
            publicKey: k.publicKey,
        }));

        const created = await OneTimePreKey.bulkCreate(records, {
            ignoreDuplicates: true, // 忽略重复的 keyId
        });

        return created.length;
    }
}

// 定义 OneTimePreKey 模型
OneTimePreKey.init({
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
            key: 'id',
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE',
        field: 'user_id',
    },
    keyId: {
        type: DataTypes.INTEGER,
        allowNull: false,
        field: 'key_id',
        comment: '客户端生成的密钥 ID',
    },
    publicKey: {
        type: DataTypes.TEXT,
        allowNull: false,
        field: 'public_key',
        comment: 'Base64 编码的一次性公钥',
    },
    createdAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
        field: 'created_at',
    },
}, {
    sequelize,
    modelName: 'OneTimePreKey',
    tableName: 'one_time_pre_keys',
    timestamps: false,
    indexes: [
        // 用户 ID 索引（查询用户的所有预密钥）
        {
            fields: ['user_id'],
        },
        // 用户 ID + 密钥 ID 唯一索引
        {
            unique: true,
            fields: ['user_id', 'key_id'],
        },
    ],
});

export default OneTimePreKey;
