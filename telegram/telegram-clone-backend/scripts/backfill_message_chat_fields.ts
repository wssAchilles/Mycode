import mongoose from 'mongoose';
import { connectMongoDB } from '../src/config/db';
import Message from '../src/models/Message';
import ChatCounter from '../src/models/ChatCounter';
import { buildGroupChatId, buildPrivateChatId } from '../src/utils/chat';

const getChatIdForMessage = (msg: any): { chatId: string; chatType: 'private' | 'group'; groupId?: string } => {
  const isGroup = !!msg.isGroupChat || (msg.receiver && msg.isGroupChat);
  if (isGroup) {
    const groupId = msg.groupId || msg.receiver;
    return { chatId: buildGroupChatId(groupId), chatType: 'group', groupId };
  }
  return { chatId: buildPrivateChatId(msg.sender, msg.receiver), chatType: 'private' };
};

const backfill = async () => {
  await connectMongoDB();

  const cursor = Message.find({ $or: [{ chatId: { $exists: false } }, { chatId: null }, { seq: { $exists: false } }, { seq: null }] })
    .sort({ timestamp: 1, _id: 1 })
    .cursor();

  const chats = new Map<string, any[]>();

  for await (const msg of cursor) {
    const { chatId, chatType, groupId } = getChatIdForMessage(msg);
    if (!chats.has(chatId)) {
      chats.set(chatId, []);
    }
    chats.get(chatId)!.push({ msg, chatType, groupId });
  }

  for (const [chatId, items] of chats.entries()) {
    const counter = await ChatCounter.findById(chatId).lean();
    let currentSeq = counter?.seq || 0;

    for (const item of items) {
      const msg = item.msg as any;
      const update: any = {};

      if (!msg.chatId) update.chatId = chatId;
      if (!msg.chatType) update.chatType = item.chatType;
      if (item.groupId && !msg.groupId) update.groupId = item.groupId;

      if (!msg.seq) {
        currentSeq += 1;
        update.seq = currentSeq;
      } else if (msg.seq > currentSeq) {
        currentSeq = msg.seq;
      }

      if (Object.keys(update).length > 0) {
        await Message.updateOne({ _id: msg._id }, { $set: update });
      }
    }

    await ChatCounter.updateOne({ _id: chatId }, { $set: { seq: currentSeq } }, { upsert: true });
  }

  await mongoose.disconnect();
};

backfill()
  .then(() => {
    console.log('✅ Backfill 完成');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Backfill 失败:', err);
    process.exit(1);
  });
