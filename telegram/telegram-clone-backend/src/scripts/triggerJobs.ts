/**
 * 手动触发机器学习任务脚本
 * 运行: 
 *   npx ts-node src/scripts/triggerJobs.ts --job simclusters
 *   npx ts-node src/scripts/triggerJobs.ts --job realgraph
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { SimClustersBatchJob } from '../services/jobs/SimClustersBatchJob';
import { RealGraphDecayJob } from '../services/jobs/RealGraphDecayJob';
import { featureExportJob } from '../services/jobs/FeatureExportJob';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// 改进参数解析
const args = process.argv.slice(2);
let jobName = '';

// 尝试查找 --job 参数
const jobArgIndex = args.findIndex(arg => arg.startsWith('--job'));
if (jobArgIndex !== -1) {
    if (args[jobArgIndex].includes('=')) {
        jobName = args[jobArgIndex].split('=')[1];
    } else {
        jobName = args[jobArgIndex + 1];
    }
} else {
    // 如果没有 --job，尝试直接获取最后一个参数
    jobName = args[args.length - 1];
}

// 移除可能的前缀
jobName = jobName ? jobName.replace('--job=', '') : '';

console.log('🛠️  Received args:', args);
console.log('🛠️  Parsed jobName:', jobName);

const validJobs = ['simclusters', 'realgraph', 'feature-export'];

async function runJob() {
    if (!jobName || !validJobs.includes(jobName)) {
        console.error(`❌ 请指定有效的任务名称: ${validJobs.join(', ')}`);
        console.error('示例: npm run job:simclusters');
        process.exit(1);
    }

    console.log(`🚀 正在手动触发任务: ${jobName.toUpperCase()}...\n`);

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI 未配置');
        process.exit(1);
    }

    try {
        await mongoose.connect(mongoUri);
        console.log('✅ MongoDB 已连接');

        if (jobName === 'simclusters') {
            console.log('🔄 开始 SimClustersBatchJob...');
            const job = new SimClustersBatchJob();
            await job.run();
            console.log('✅ SimClustersBatchJob 完成');
        } else if (jobName === 'realgraph') {
            console.log('🔄 开始 RealGraphDecayJob...');
            const job = new RealGraphDecayJob();
            await job.run();
            console.log('✅ RealGraphDecayJob 完成');
        } else if (jobName === 'feature-export') {
            console.log('🔄 开始 FeatureExportJob...');
            await featureExportJob.run();
            console.log('✅ FeatureExportJob 完成');
        }

        await mongoose.disconnect();
        console.log('\n✅ 数据库连接已关闭');
        console.log('🎉 任务执行成功！');
        process.exit(0);

    } catch (error) {
        console.error('❌ 任务执行失败:', error);
        process.exit(1);
    }
}

runJob();
