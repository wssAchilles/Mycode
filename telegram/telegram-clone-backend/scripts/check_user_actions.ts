
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// 加载环境变量 (这也是为了复用后端的依赖环境)
// 假设脚本在 telegram-clone-backend/scripts/ 下，而 .env 在项目根目录 (telegram/telegram/.env)
// 所以路径应该是 ../../.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    console.error('❌ MONGODB_URI 未设置。请确保 .env 文件存在且包含 MONGODB_URI。');
    console.log('尝试加载路径:', path.resolve(__dirname, '../../.env'));
    process.exit(1);
}

// 简单的 UserAction Schema 定义 (只读)
const UserActionSchema = new mongoose.Schema({
    userId: String,
    action: String,
    targetPostId: mongoose.Schema.Types.ObjectId,
    targetAuthorId: String,
    timestamp: Date,
}, { collection: 'user_actions', strict: false });

const UserAction = mongoose.model('UserAction', UserActionSchema);

async function checkActions() {
    try {
        console.log('Connecting to MongoDB...');
        // 屏蔽严格模式警告
        mongoose.set('strictQuery', false);
        await mongoose.connect(MONGODB_URI as string);
        console.log('✅ Connected.');

        const count = await UserAction.countDocuments();
        console.log(`\n📊 Total User Actions: ${count}`);

        const recentActions = await UserAction.find()
            .sort({ timestamp: -1 })
            .limit(10)
            .lean();

        console.log('\n🕒 Recent 10 Actions:');
        if (recentActions.length === 0) {
            console.log('  (No actions found)');
        } else {
            recentActions.forEach((action: any) => {
                const time = action.timestamp ? new Date(action.timestamp).toISOString() : 'N/A';
                console.log(`  - [${time}] User:${action.userId} Action:${action.action} Target:${action.targetPostId}`);
            });
        }

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\nDisconnected.');
    }
}

checkActions();
