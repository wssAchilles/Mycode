/**
 * 全量数据种子脚本 - 为所有推荐相关表填充模拟数据
 * 
 * 用途: 基于现有用户和帖子数据，生成完整的推荐系统基础数据
 * 运行: npx ts-node src/scripts/seedAllData.ts
 * 
 * 填充表:
 * - cluster_definitions (已通过 seedClusters.ts 完成)
 * - comments
 * - real_graph_edges
 * - user_feature_vectors
 * - user_signals
 * - usersettings
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// 导入模型
import Comment from '../models/Comment';
import RealGraphEdge, { InteractionType } from '../models/RealGraphEdge';
import UserFeatureVector from '../models/UserFeatureVector';
import UserSignal, { SignalType, ProductSurface, TargetType } from '../models/UserSignal';
import UserSettings from '../models/UserSettings';
import Post from '../models/Post';
import ClusterDefinition from '../models/ClusterDefinition';

// PostgreSQL (用户表)
import { Sequelize, DataTypes, Model } from 'sequelize';

// ========== 工具函数 ==========
function randomChoice<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

// ========== 主函数 ==========
async function seedAllData() {
    console.log('🌱 开始全量数据种子...\n');

    // 连接 MongoDB
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI 未配置');
        process.exit(1);
    }

    // 连接 PostgreSQL
    const pgUri = process.env.DATABASE_URL;
    if (!pgUri) {
        console.error('❌ DATABASE_URL 未配置');
        process.exit(1);
    }

    try {
        await mongoose.connect(mongoUri);
        console.log('✅ MongoDB 已连接');

        const sequelize = new Sequelize(pgUri, {
            dialect: 'postgres',
            logging: false,
            dialectOptions: {
                ssl: { require: true, rejectUnauthorized: false }
            }
        });
        await sequelize.authenticate();
        console.log('✅ PostgreSQL 已连接');

        // 定义 User 模型 (简化版)
        class User extends Model {
            declare id: string;
            declare username: string;
        }
        User.init(
            {
                id: { type: DataTypes.UUID, primaryKey: true },
                username: DataTypes.STRING,
            },
            { sequelize, tableName: 'users', timestamps: false }
        );

        // ========== 1. 获取现有数据 ==========
        console.log('\n📊 获取现有数据...');

        const users = await User.findAll({ limit: 100 });
        console.log(`   找到 ${users.length} 个用户:`);
        users.forEach(u => console.log(`   - 👤 ${u.username} (ID: ${u.id})`));

        if (users.length === 0) {
            console.log('⚠️ 没有用户数据，无法生成种子数据');
            await mongoose.disconnect();
            await sequelize.close();
            return;
        }

        const posts = await Post.find({ deletedAt: null }).limit(50).lean();
        console.log(`   找到 ${posts.length} 个帖子`);

        const clusters = await ClusterDefinition.find({ isActive: true }).lean();
        console.log(`   找到 ${clusters.length} 个聚类`);

        const userIds = users.map(u => u.id);

        // ========== 2. 种子 UserSettings ==========
        console.log('\n📝 种子 UserSettings...');
        const existingSettings = await UserSettings.countDocuments();
        if (existingSettings > 0) {
            console.log(`   ⚠️ 已有 ${existingSettings} 条数据，跳过`);
        } else {
            const settingsDocs = userIds.map(userId => ({
                userId,
                mutedKeywords: [],
                mutedUserIds: [],
                notificationSettings: {
                    likes: true,
                    replies: true,
                    reposts: true,
                    mentions: true,
                    newFollowers: true,
                    directMessages: true,
                },
                feedSettings: {
                    showReplies: true,
                    showReposts: true,
                    preferInNetwork: randomChoice([true, false]),
                    sensitiveContentFilter: true,
                },
                privacySettings: {
                    allowDirectMessages: randomChoice(['everyone', 'followers'] as const),
                    showOnlineStatus: true,
                    showReadReceipts: true,
                },
            }));
            await UserSettings.insertMany(settingsDocs);
            console.log(`   ✅ 插入 ${settingsDocs.length} 条 UserSettings`);
        }

        // ========== 3. 种子 RealGraphEdges (用户关系分数) ==========
        console.log('\n🔗 种子 RealGraphEdges...');
        const existingEdges = await RealGraphEdge.countDocuments();
        if (existingEdges > 0) {
            console.log(`   ⚠️ 已有 ${existingEdges} 条数据，跳过`);
        } else {
            const edgeDocs: any[] = [];
            // 为每个用户创建 3-8 个关系
            for (const sourceUserId of userIds) {
                const targetCount = randomInt(3, Math.min(8, userIds.length - 1));
                const targets = userIds
                    .filter(id => id !== sourceUserId)
                    .sort(() => Math.random() - 0.5)
                    .slice(0, targetCount);

                for (const targetUserId of targets) {
                    const now = new Date();
                    const likeCount = randomInt(0, 20);
                    const replyCount = randomInt(0, 10);
                    const followCount = randomChoice([0, 1]); // 0 或 1

                    edgeDocs.push({
                        sourceUserId,
                        targetUserId,
                        dailyCounts: {
                            followCount,
                            likeCount: randomInt(0, 3),
                            replyCount: randomInt(0, 2),
                            retweetCount: 0,
                            quoteCount: 0,
                            mentionCount: 0,
                            profileViewCount: randomInt(0, 5),
                            tweetClickCount: randomInt(0, 10),
                            dwellTimeMs: randomInt(0, 60000),
                            muteCount: 0,
                            blockCount: 0,
                            reportCount: 0,
                        },
                        rollupCounts: {
                            followCount,
                            likeCount,
                            replyCount,
                            retweetCount: randomInt(0, 5),
                            quoteCount: randomInt(0, 3),
                            mentionCount: randomInt(0, 5),
                            profileViewCount: randomInt(5, 50),
                            tweetClickCount: randomInt(10, 100),
                            dwellTimeMs: randomInt(60000, 600000),
                            muteCount: 0,
                            blockCount: 0,
                            reportCount: 0,
                        },
                        decayedSum: randomFloat(1, 50),
                        interactionProbability: randomFloat(0.1, 0.9),
                        firstInteractionAt: new Date(now.getTime() - randomInt(1, 30) * 24 * 60 * 60 * 1000),
                        lastInteractionAt: new Date(now.getTime() - randomInt(0, 3) * 24 * 60 * 60 * 1000),
                        lastDecayAppliedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
                    });
                }
            }
            await RealGraphEdge.insertMany(edgeDocs);
            console.log(`   ✅ 插入 ${edgeDocs.length} 条 RealGraphEdges`);
        }

        // ========== 4. 种子 Comments ==========
        console.log('\n💬 种子 Comments...');
        const existingComments = await Comment.countDocuments();
        if (existingComments > 0) {
            console.log(`   ⚠️ 已有 ${existingComments} 条数据，跳过`);
        } else if (posts.length === 0) {
            console.log('   ⚠️ 没有帖子数据，跳过评论种子');
        } else {
            const commentTexts = [
                '很棒的分享！', '学习了 👍', '感谢分享',
                '这个观点有道理', '支持！', '讲得很好',
                '有帮助', '收藏了', '同意这个看法',
                '写得不错', '期待更多', '很有启发',
            ];
            const commentDocs: any[] = [];
            for (const post of posts) {
                const commentCount = randomInt(1, 5);
                for (let i = 0; i < commentCount; i++) {
                    commentDocs.push({
                        userId: randomChoice(userIds),
                        postId: post._id,
                        content: randomChoice(commentTexts),
                        likeCount: randomInt(0, 10),
                        createdAt: new Date(Date.now() - randomInt(0, 7) * 24 * 60 * 60 * 1000),
                    });
                }
            }
            await Comment.insertMany(commentDocs);
            console.log(`   ✅ 插入 ${commentDocs.length} 条 Comments`);
        }

        // ========== 5. 种子 UserSignals ==========
        console.log('\n📡 种子 UserSignals...');
        const existingSignals = await UserSignal.countDocuments();
        if (existingSignals > 0) {
            console.log(`   ⚠️ 已有 ${existingSignals} 条数据，跳过`);
        } else if (posts.length === 0) {
            console.log('   ⚠️ 没有帖子数据，跳过信号种子');
        } else {
            const signalDocs: any[] = [];
            // 为每个用户生成 10-30 个信号
            for (const userId of userIds) {
                const signalCount = randomInt(10, 30);
                for (let i = 0; i < signalCount; i++) {
                    const post = randomChoice(posts);
                    const signalType = randomChoice([
                        SignalType.FAVORITE,
                        SignalType.TWEET_CLICK,
                        SignalType.DWELL,
                        SignalType.IMPRESSION,
                        SignalType.PROFILE_CLICK,
                    ]);
                    const timestamp = new Date(Date.now() - randomInt(0, 7) * 24 * 60 * 60 * 1000);

                    signalDocs.push({
                        userId,
                        signalType,
                        targetId: post._id.toString(),
                        targetType: TargetType.POST,
                        targetAuthorId: post.authorId,
                        productSurface: randomChoice([
                            ProductSurface.HOME_FEED,
                            ProductSurface.SEARCH,
                            ProductSurface.PROFILE,
                        ]),
                        metadata: {},
                        dwellTimeMs: signalType === SignalType.DWELL ? randomInt(1000, 30000) : undefined,
                        timestamp,
                        expiresAt: new Date(timestamp.getTime() + 7 * 24 * 60 * 60 * 1000),
                    });
                }
            }
            await UserSignal.insertMany(signalDocs);
            console.log(`   ✅ 插入 ${signalDocs.length} 条 UserSignals`);
        }

        // ========== 6. 种子 UserFeatureVectors ==========
        console.log('\n🧮 种子 UserFeatureVectors...');
        const existingVectors = await UserFeatureVector.countDocuments();
        if (existingVectors > 0) {
            console.log(`   ⚠️ 已有 ${existingVectors} 条数据，跳过`);
        } else if (clusters.length === 0) {
            console.log('   ⚠️ 没有聚类数据，跳过特征向量种子');
        } else {
            const vectorDocs: any[] = [];
            for (const userId of userIds) {
                // 生成稀疏 InterestedIn 向量 (3-8 个聚类)
                const interestedCount = randomInt(3, Math.min(8, clusters.length));
                const selectedClusters = clusters
                    .sort(() => Math.random() - 0.5)
                    .slice(0, interestedCount);

                const interestedInClusters = selectedClusters.map(c => ({
                    clusterId: c.clusterId,
                    score: randomFloat(0.1, 1.0),
                }));

                // KnownFor (生产者主聚类)
                const knownForCluster = randomChoice(selectedClusters);

                vectorDocs.push({
                    userId,
                    interestedInClusters,
                    knownForCluster: knownForCluster.clusterId,
                    knownForScore: randomFloat(0.5, 1.0),
                    producerEmbedding: interestedInClusters.slice(0, 3),
                    version: 1,
                    modelVersion: 'simclusters_v1',
                    computedAt: new Date(),
                    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
                    qualityScore: randomFloat(0.5, 1.0),
                });
            }
            await UserFeatureVector.insertMany(vectorDocs);
            console.log(`   ✅ 插入 ${vectorDocs.length} 条 UserFeatureVectors`);
        }

        // ========== 完成 ==========
        console.log('\n🎉 全量数据种子完成！');
        console.log('\n📋 数据统计:');
        console.log(`   UserSettings:      ${await UserSettings.countDocuments()}`);
        console.log(`   RealGraphEdges:    ${await RealGraphEdge.countDocuments()}`);
        console.log(`   Comments:          ${await Comment.countDocuments()}`);
        console.log(`   UserSignals:       ${await UserSignal.countDocuments()}`);
        console.log(`   UserFeatureVectors: ${await UserFeatureVector.countDocuments()}`);
        console.log(`   ClusterDefinitions: ${await ClusterDefinition.countDocuments()}`);

        await mongoose.disconnect();
        await sequelize.close();
        console.log('\n✅ 数据库连接已关闭');

    } catch (error) {
        console.error('❌ 种子失败:', error);
        process.exit(1);
    }
}

// 运行
seedAllData();
