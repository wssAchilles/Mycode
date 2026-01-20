import { Router, Response, Request } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import Message from '../models/Message';
import User from '../models/User';
import { AiConversation } from '../models/AiConversation';

// 扩展Request接口
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
    email?: string;
    avatarUrl?: string;
  };
}

const router = Router();

// 获取AI聊天记录
router.get('/messages', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const skip = (page - 1) * limit;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '用户未认证'
      });
    }

    // 查找 AI 机器人用户 ID
    const aiBot = await User.findOne({ where: { username: 'Gemini AI' } });
    const aiBotId = aiBot?.id;

    // 构建查询条件：同时匹配 'ai' 字符串和实际的 bot ID
    const senderConditions: any[] = [{ sender: 'ai' }];
    const receiverConditions: any[] = [{ receiver: 'ai' }];

    if (aiBotId) {
      senderConditions.push({ sender: aiBotId });
      receiverConditions.push({ receiver: aiBotId });
    }

    // 查询AI聊天消息（发送给AI或AI回复的消息）
    const messages = await Message.find({
      $or: [
        { sender: userId, $or: receiverConditions },
        { $or: senderConditions, receiver: userId }
      ]
    })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    // 格式化消息
    const formattedMessages = messages.map((msg: any) => ({
      id: msg._id.toString(),
      content: msg.content,
      senderId: msg.sender,
      senderUsername: (msg.sender === 'ai' || msg.sender === aiBotId) ? 'Gemini AI' : 'You',
      timestamp: msg.timestamp.toISOString(),
      type: msg.type,
      isGroupChat: false,
      status: msg.status
    }));

    // 反转数组，使最早的消息在前面（符合聊天界面显示）
    const sortedMessages = formattedMessages.reverse();

    res.json({
      success: true,
      data: {
        messages: sortedMessages,
        pagination: {
          page,
          limit,
          total: messages.length,
          hasMore: messages.length === limit
        }
      }
    });

  } catch (error: any) {
    console.error('获取AI聊天记录失败:', error);
    res.status(500).json({
      success: false,
      message: '获取聊天记录失败',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 清空AI聊天记录
router.delete('/messages', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: '用户未认证'
      });
    }

    // 删除所有AI聊天消息
    const result = await Message.deleteMany({
      $or: [
        { sender: userId, receiver: 'ai' },
        { sender: 'ai', receiver: userId }
      ]
    });

    res.json({
      success: true,
      message: `已清空 ${result.deletedCount} 条AI聊天记录`
    });

  } catch (error: any) {
    console.error('清空AI聊天记录失败:', error);
    res.status(500).json({
      success: false,
      message: '清空聊天记录失败',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// 获取 AI 会话列表
router.get('/conversations', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '用户未认证' });
    }

    const conversations = await AiConversation.find({ userId, isActive: true })
      .sort({ updatedAt: -1 })
      .select('conversationId title updatedAt messages');

    res.json({
      success: true,
      data: conversations
    });
  } catch (error: any) {
    console.error('获取AI会话列表失败:', error);
    res.status(500).json({ success: false, message: '获取会话列表失败' });
  }
});

// 获取单个 AI 会话详情
router.get('/conversations/:conversationId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { conversationId } = req.params;
    if (!userId) {
      return res.status(401).json({ success: false, message: '用户未认证' });
    }

    const conversation = await AiConversation.findOne({ conversationId, userId, isActive: true });
    if (!conversation) {
      return res.status(404).json({ success: false, message: '会话不存在' });
    }

    res.json({ success: true, data: conversation });
  } catch (error: any) {
    console.error('获取AI会话详情失败:', error);
    res.status(500).json({ success: false, message: '获取会话详情失败' });
  }
});

// 删除 AI 会话
router.delete('/conversations/:conversationId', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { conversationId } = req.params;
    if (!userId) {
      return res.status(401).json({ success: false, message: '用户未认证' });
    }

    const conversation = await AiConversation.findOne({ conversationId, userId });
    if (!conversation) {
      return res.status(404).json({ success: false, message: '会话不存在' });
    }

    conversation.isActive = false;
    await conversation.save();

    res.json({ success: true, message: '会话已删除' });
  } catch (error: any) {
    console.error('删除AI会话失败:', error);
    res.status(500).json({ success: false, message: '删除会话失败' });
  }
});

export default router;
