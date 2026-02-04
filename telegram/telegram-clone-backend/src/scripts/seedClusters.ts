/**
 * 聚类种子脚本 - SimClusters 冷启动
 * 
 * 用途: 初始化 ClusterDefinition 表，预置核心社区聚类
 * 运行: npx ts-node src/scripts/seedClusters.ts
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import ClusterDefinition from '../models/ClusterDefinition';

// ========== 预定义聚类 ==========
const SEED_CLUSTERS = [
    {
        clusterId: 1001,
        name: 'Technology',
        description: '科技、编程、AI、软件开发',
        tags: ['tech', 'programming', 'ai', 'software', 'coding', 'developer'],
        level: 1,
        isActive: true,
    },
    {
        clusterId: 1002,
        name: 'Cryptocurrency',
        description: '加密货币、区块链、Web3',
        tags: ['crypto', 'blockchain', 'bitcoin', 'ethereum', 'web3', 'defi'],
        level: 1,
        isActive: true,
    },
    {
        clusterId: 1003,
        name: 'News & Politics',
        description: '新闻、时事、政治',
        tags: ['news', 'politics', 'world', 'breaking', 'current-events'],
        level: 1,
        isActive: true,
    },
    {
        clusterId: 1004,
        name: 'Entertainment',
        description: '娱乐、电影、音乐、明星',
        tags: ['entertainment', 'movies', 'music', 'celebrity', 'tv', 'streaming'],
        level: 1,
        isActive: true,
    },
    {
        clusterId: 1005,
        name: 'Sports',
        description: '体育、足球、篮球、比赛',
        tags: ['sports', 'football', 'basketball', 'soccer', 'nba', 'nfl'],
        level: 1,
        isActive: true,
    },
    {
        clusterId: 1006,
        name: 'Gaming',
        description: '游戏、电竞、主机、手游',
        tags: ['gaming', 'esports', 'playstation', 'xbox', 'nintendo', 'steam'],
        level: 1,
        isActive: true,
    },
    {
        clusterId: 1007,
        name: 'Finance & Business',
        description: '金融、商业、投资、股票',
        tags: ['finance', 'business', 'stocks', 'investing', 'economy', 'startup'],
        level: 1,
        isActive: true,
    },
    {
        clusterId: 1008,
        name: 'Science',
        description: '科学、物理、生物、太空',
        tags: ['science', 'physics', 'biology', 'space', 'research', 'nasa'],
        level: 1,
        isActive: true,
    },
    {
        clusterId: 1009,
        name: 'Art & Design',
        description: '艺术、设计、摄影、创意',
        tags: ['art', 'design', 'photography', 'creative', 'illustration', 'ui-ux'],
        level: 1,
        isActive: true,
    },
    {
        clusterId: 1010,
        name: 'Lifestyle',
        description: '生活方式、健康、旅行、美食',
        tags: ['lifestyle', 'health', 'travel', 'food', 'fitness', 'wellness'],
        level: 1,
        isActive: true,
    },
    {
        clusterId: 1011,
        name: 'Memes & Humor',
        description: '表情包、搞笑内容、网络文化',
        tags: ['memes', 'humor', 'funny', 'viral', 'internet-culture'],
        level: 1,
        isActive: true,
    },
    {
        clusterId: 1012,
        name: 'Education',
        description: '教育、学习、课程、知识分享',
        tags: ['education', 'learning', 'courses', 'tutorial', 'knowledge'],
        level: 1,
        isActive: true,
    },
];

// ========== 主函数 ==========
async function seedClusters() {
    console.log('🌱 Starting cluster seeding...');

    // 连接数据库
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI not found in environment');
        process.exit(1);
    }

    try {
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');

        // 检查是否已有数据
        const existingCount = await ClusterDefinition.countDocuments();
        if (existingCount > 0) {
            console.log(`⚠️ Found ${existingCount} existing clusters. Skipping seed.`);
            console.log('   To re-seed, drop the collection first: db.cluster_definitions.drop()');
            await mongoose.disconnect();
            return;
        }

        // 插入种子数据
        const now = new Date();
        const clustersToInsert = SEED_CLUSTERS.map(c => ({
            ...c,
            stats: {
                totalMembers: 0,
                activeMembersLast7d: 0,
                totalEngagements: 0,
            },
            topProducers: [],
            createdAt: now,
            updatedAt: now,
        }));

        await ClusterDefinition.insertMany(clustersToInsert);
        console.log(`✅ Seeded ${clustersToInsert.length} clusters successfully!`);

        // 列出已插入的聚类
        console.log('\n📋 Seeded clusters:');
        for (const c of SEED_CLUSTERS) {
            console.log(`   [${c.clusterId}] ${c.name} - ${c.tags.slice(0, 3).join(', ')}...`);
        }

        await mongoose.disconnect();
        console.log('\n🎉 Seed complete!');

    } catch (error) {
        console.error('❌ Seed failed:', error);
        process.exit(1);
    }
}

// 运行
seedClusters();
