import { Router, Response, Request } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import Message from '../models/Message';

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

    // 查询AI聊天消息（发送给AI或AI回复的消息）
    const messages = await Message.find({
      $or: [
        { sender: userId, receiver: 'ai' },
        { sender: 'ai', receiver: userId }
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
      senderUsername: msg.sender === 'ai' ? 'Gemini AI' : 'You',
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

export default router;
