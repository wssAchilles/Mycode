/**
 * Migration: backfill chatId/chatType/groupId/seq for messages
 * Run:
 *   npx ts-node src/scripts/migrateMessagesChatFields.ts
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import Message from '../models/Message';
import ChatCounter from '../models/ChatCounter';
import { buildGroupChatId, buildPrivateChatId } from '../utils/chat';

// Load env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const BATCH_SIZE = 500;

let sequelizeInstance: any | null = null;

async function loadGroupIdSet(): Promise<Set<string>> {
  try {
    const { sequelize } = await import('../config/sequelize');
    const { default: Group } = await import('../models/Group');
    sequelizeInstance = sequelize;
    await sequelize.authenticate();
    const groups = await Group.findAll({ attributes: ['id'] });
    return new Set(groups.map((g: any) => g.id));
  } catch (error) {
    console.warn('⚠️ 无法加载群组ID列表，将只基于消息字段推断群聊类型');
    console.warn('⚠️ PostgreSQL 连接错误:', error instanceof Error ? error.message : error);
    return new Set();
  }
}

async function migrateFields(groupIdSet: Set<string>) {
  const query = {
    $or: [
      { chatId: { $in: [null, ''] } },
      { chatType: { $in: [null, ''] } },
      { groupId: { $in: [null, ''] } },
      { seq: null },
    ],
  };

  const cursor = Message.find(query).sort({ timestamp: 1 }).cursor();
  let bulk: any[] = [];
  let processed = 0;
  let updated = 0;

  for await (const msg of cursor) {
    processed += 1;
    const rawChatId = msg.chatId as string | null | undefined;
    let chatType = msg.chatType as 'private' | 'group' | null | undefined;
    let groupId = msg.groupId as string | null | undefined;

    const isGroupByChatId = typeof rawChatId === 'string' && rawChatId.startsWith('g:');
    const isGroupByFlags = !!msg.isGroupChat;
    const isGroupByGroupId = !!groupId;
    const isGroupByReceiver = groupIdSet.has(String(msg.receiver));

    if (!chatType) {
      chatType = (isGroupByChatId || isGroupByFlags || isGroupByGroupId || isGroupByReceiver) ? 'group' : 'private';
    }

    if (chatType === 'group') {
      if (!groupId) {
        if (isGroupByChatId && rawChatId) {
          groupId = rawChatId.substring(2);
        } else if (isGroupByFlags) {
          groupId = String(msg.receiver);
        } else if (isGroupByReceiver) {
          groupId = String(msg.receiver);
        }
      }
    }

    let chatId = rawChatId;
    if (!chatId) {
      if (chatType === 'group') {
        if (!groupId) {
          continue; // 无法推断群ID，跳过
        }
        chatId = buildGroupChatId(groupId);
      } else {
        chatId = buildPrivateChatId(String(msg.sender), String(msg.receiver));
      }
    }

    const update: any = {};
    if (msg.chatId !== chatId) update.chatId = chatId;
    if (msg.chatType !== chatType) update.chatType = chatType;
    if (chatType === 'group' && groupId && msg.groupId !== groupId) update.groupId = groupId;
    if (msg.isGroupChat !== (chatType === 'group')) update.isGroupChat = chatType === 'group';

    if (Object.keys(update).length) {
      bulk.push({ updateOne: { filter: { _id: msg._id }, update: { $set: update } } });
      updated += 1;
    }

    if (bulk.length >= BATCH_SIZE) {
      await Message.bulkWrite(bulk);
      bulk = [];
      console.log(`✅ 字段回填进度: ${processed} 处理 / ${updated} 更新`);
    }
  }

  if (bulk.length) {
    await Message.bulkWrite(bulk);
  }

  console.log(`✅ 字段回填完成: ${processed} 处理 / ${updated} 更新`);
}

async function backfillSeq() {
  const chatIds: string[] = await Message.distinct('chatId', { seq: null, chatId: { $ne: null } });
  console.log(`🧩 需要回填 seq 的 chat 数: ${chatIds.length}`);

  for (const chatId of chatIds) {
    const [latest, counter] = await Promise.all([
      Message.findOne({ chatId, seq: { $ne: null } }).sort({ seq: -1 }).lean(),
      ChatCounter.findById(chatId).lean(),
    ]);
    let nextSeq = Math.max(latest?.seq || 0, counter?.seq || 0);

    const cursor = Message.find({ chatId, seq: null }).sort({ timestamp: 1, _id: 1 }).cursor();
    const bulk: any[] = [];
    for await (const msg of cursor) {
      nextSeq += 1;
      bulk.push({ updateOne: { filter: { _id: msg._id }, update: { $set: { seq: nextSeq } } } });
      if (bulk.length >= BATCH_SIZE) {
        await Message.bulkWrite(bulk);
        bulk.length = 0;
      }
    }
    if (bulk.length) {
      await Message.bulkWrite(bulk);
    }

    await ChatCounter.updateOne({ _id: chatId }, { $set: { seq: nextSeq } }, { upsert: true });
    console.log(`✅ chat ${chatId} seq 回填完成，最新 seq=${nextSeq}`);
  }
}

async function run() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error('❌ MONGODB_URI 未配置');
    process.exit(1);
  }

  try {
    await mongoose.connect(mongoUri);
    console.log('✅ MongoDB 已连接');

    const groupIdSet = await loadGroupIdSet();
    console.log(`✅ 已加载群组ID数: ${groupIdSet.size}`);

    await migrateFields(groupIdSet);
    await backfillSeq();

    await mongoose.disconnect();
    if (sequelizeInstance) {
      await sequelizeInstance.close().catch(() => undefined);
    }
    console.log('✅ 迁移完成');
  } catch (error) {
    console.error('❌ 迁移失败:', error);
    process.exit(1);
  }
}

run();
