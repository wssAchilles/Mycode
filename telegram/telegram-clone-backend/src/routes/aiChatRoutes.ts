import { Router, Response, Request } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import Message from '../models/Message';
import User from '../models/User';
import { AiConversation } from '../models/AiConversation';
import { callGeminiAI } from '../controllers/aiController';

const truncate = (text: string, max = 200) => {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...`;
};

const sanitizeTitle = (text: string) => {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\"“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);
};

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

// 归档当前 AI 会话并生成标题
router.post('/conversations/archive', authenticateToken, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: '用户未认证' });
    }

    const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const filtered = rawMessages
      .filter((msg: any) => msg && typeof msg.content === 'string' && msg.content.trim())
      .slice(-20);

    if (filtered.length === 0) {
      return res.status(400).json({ success: false, message: '没有可归档的对话内容' });
    }

    const transcript = filtered
      .map((msg: any) => {
        const roleLabel = msg.role === 'assistant' ? '助手' : '用户';
        return `${roleLabel}: ${truncate(msg.content.trim(), 200)}`;
      })
      .join('\n');

    const prompt = `请用不超过20字概括下面对话主题，输出简短标题，不要加引号或标点：\n${transcript}`;
    let title = sanitizeTitle(await callGeminiAI(prompt));

    if (!title) {
      const firstUser = filtered.find((msg: any) => msg.role === 'user');
      title = sanitizeTitle(firstUser?.content || filtered[0].content || '新的AI对话');
    }

    const conversationId = `ai_${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const messages = filtered.map((msg: any, idx: number) => ({
      id: `${conversationId}_${idx}`,
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content,
      timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
      type: msg.type === 'image' ? 'image' : 'text',
      imageData: msg.imageData ? {
        mimeType: msg.imageData.mimeType,
        fileName: msg.imageData.fileName,
        fileSize: msg.imageData.fileSize,
      } : undefined
    }));

    const conversation = await AiConversation.create({
      userId,
      conversationId,
      title,
      messages,
      isActive: true
    });

    return res.json({
      success: true,
      data: {
        conversationId: conversation.conversationId,
        title: conversation.title,
        updatedAt: conversation.updatedAt
      }
    });
  } catch (error: any) {
    console.error('归档AI会话失败:', error);
    return res.status(500).json({ success: false, message: '归档AI会话失败' });
  }
});

export default router;
