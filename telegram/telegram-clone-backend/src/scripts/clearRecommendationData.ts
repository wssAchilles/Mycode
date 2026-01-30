/**
 * 清空推荐系统相关表
 * 运行: npx ts-node src/scripts/clearRecommendationData.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function clearData() {
    console.log('🧹 开始清空推荐系统数据...\n');

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI 未配置');
        process.exit(1);
    }

    try {
        await mongoose.connect(mongoUri);
        console.log('✅ MongoDB 已连接');

        const collections = [
            'user_signals',
            'usersettings',
            'real_graph_edges',
            'comments',
            'user_feature_vectors',
        ];

        for (const collectionName of collections) {
            try {
                const db = mongoose.connection.db;
                if (!db) {
                    throw new Error('数据库连接未初始化');
                }
                await db.collection(collectionName).drop();
                console.log(`✅ 已删除: ${collectionName}`);
            } catch (error: any) {
                if (error.code === 26) {
                    console.log(`⚠️  ${collectionName} 不存在，跳过`);
                } else {
                    console.error(`❌ 删除 ${collectionName} 失败:`, error.message);
                }
            }
        }

        await mongoose.disconnect();
        console.log('\n🎉 清空完成！现在可以运行 npm run seed:all');

    } catch (error) {
        console.error('❌ 清空失败:', error);
        process.exit(1);
    }
}

clearData();
