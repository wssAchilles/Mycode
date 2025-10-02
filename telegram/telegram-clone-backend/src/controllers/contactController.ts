import { Request, Response } from 'express';
import Contact, { ContactStatus } from '../models/Contact';
import User from '../models/User';
import { Op } from 'sequelize';

// 扩展请求接口
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    username: string;
  };
}

/**
 * 添加联系人请求
 */
export const addContact = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { contactId, message } = req.body;
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }
    
    if (!contactId) {
      return res.status(400).json({ error: '联系人 ID 不能为空' });
    }
    
    // 不能添加自己为联系人
    if (userId === contactId) {
      return res.status(400).json({ error: '不能添加自己为联系人' });
    }
    
    // 验证联系人用户是否存在
    const contactUser = await User.findByPk(contactId);
    if (!contactUser) {
      return res.status(404).json({ error: '用户不存在' });
    }
    
    // 检查是否已经存在联系人关系
    const existingContact = await Contact.findOne({
      where: {
        userId,
        contactId
      }
    });
    
    if (existingContact) {
      if (existingContact.status === ContactStatus.ACCEPTED) {
        return res.status(400).json({ error: '该用户已经是您的联系人' });
      }
      if (existingContact.status === ContactStatus.PENDING) {
        return res.status(400).json({ error: '联系人请求已发送，请等待对方确认' });
      }
      if (existingContact.status === ContactStatus.BLOCKED) {
        return res.status(400).json({ error: '您已被该用户屏蔽' });
      }
    }
    
    // 创建联系人请求
    const newContact = await Contact.create({
      userId,
      contactId,
      status: ContactStatus.PENDING
    });
    
    // 返回创建的联系人信息
    const contactWithUser = await Contact.findByPk(newContact.id, {
      include: [
        {
          model: User,
          as: 'contact', // 使用正确的关联别名
          attributes: ['id', 'username', 'email', 'avatarUrl']
        }
      ]
    });
    
    res.status(201).json({
      message: '联系人请求已发送',
      contact: contactWithUser
    });
  } catch (error) {
    console.error('添加联系人失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 获取联系人列表
 */
export const getContacts = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { status = ContactStatus.ACCEPTED } = req.query;
    
    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }
    
    // 获取联系人列表
    const contacts = await Contact.findAll({
      where: {
        userId,
        status: status as ContactStatus
      },
      include: [
        {
          model: User,
          as: 'contact', // 使用与关联定义中相同的别名
          attributes: ['id', 'username', 'email', 'avatarUrl']
        }
      ],
      order: [['addedAt', 'DESC']]
    });
    
    res.json({
      contacts,
      total: contacts.length
    });
  } catch (error) {
    console.error('获取联系人列表失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 获取待处理的联系人请求
 */
export const getPendingRequests = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }
    
    // 获取发送给当前用户的待处理请求
    const pendingRequests = await Contact.findAll({
      where: {
        contactId: userId,
        status: ContactStatus.PENDING
      },
      include: [
        {
          model: User,
          as: 'user', // 使用与关联定义中相同的别名
          attributes: ['id', 'username', 'email', 'avatarUrl']
        }
      ],
      order: [['addedAt', 'DESC']]
    });
    
    res.json({
      requests: pendingRequests,
      total: pendingRequests.length
    });
  } catch (error) {
    console.error('获取待处理请求失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 处理联系人请求（接受/拒绝）
 */
export const handleContactRequest = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { requestId } = req.params;
    const { action } = req.body; // 'accept' or 'reject'
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }
    
    if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ error: '无效的操作类型' });
    }
    
    // 查找联系人请求
    const contactRequest = await Contact.findOne({
      where: {
        id: requestId,
        contactId: userId,
        status: ContactStatus.PENDING
      }
    });
    
    if (!contactRequest) {
      return res.status(404).json({ error: '联系人请求不存在或已处理' });
    }
    
    if (action === 'accept') {
      // 接受请求
      await contactRequest.accept();
      
      res.json({
        message: '联系人请求已接受',
        contact: contactRequest
      });
    } else {
      // 拒绝请求
      await contactRequest.reject();
      
      res.json({
        message: '联系人请求已拒绝',
        contact: contactRequest
      });
    }
  } catch (error) {
    console.error('处理联系人请求失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 删除联系人
 */
export const removeContact = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { contactId } = req.params;
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }
    
    // 查找联系人关系
    const contact = await Contact.findOne({
      where: {
        userId,
        contactId,
        status: ContactStatus.ACCEPTED
      }
    });
    
    if (!contact) {
      return res.status(404).json({ error: '联系人关系不存在' });
    }
    
    // 删除双向联系人关系
    await Contact.destroy({
      where: {
        [Op.or]: [
          { userId, contactId },
          { userId: contactId, contactId: userId }
        ]
      }
    });
    
    res.json({ message: '联系人已删除' });
  } catch (error) {
    console.error('删除联系人失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 屏蔽联系人
 */
export const blockContact = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { contactId } = req.params;
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }
    
    // 查找或创建联系人关系
    const [contact] = await Contact.findOrCreate({
      where: {
        userId,
        contactId
      },
      defaults: {
        userId,
        contactId,
        status: ContactStatus.BLOCKED
      }
    });
    
    // 屏蔽联系人
    contact.status = ContactStatus.BLOCKED;
    await contact.save();
    
    res.json({
      message: '联系人已屏蔽',
      contact
    });
  } catch (error) {
    console.error('屏蔽联系人失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 搜索用户（用于添加联系人）
 */
export const searchUsers = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { query } = req.query;
    const userId = req.user?.id;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    
    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }
    
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({ error: '搜索关键词至少需要2个字符' });
    }
    
    // 搜索用户（排除自己）
    const users = await User.findAll({
      where: {
        id: { [Op.ne]: userId },
        [Op.or]: [
          { username: { [Op.iLike]: `%${query.trim()}%` } },
          { email: { [Op.iLike]: `%${query.trim()}%` } }
        ]
      },
      attributes: ['id', 'username', 'email', 'avatarUrl'],
      limit
    });
    
    // 获取当前用户的联系人状态
    const userIds = users.map(user => user.id);
    const existingContacts = await Contact.findAll({
      where: {
        userId,
        contactId: { [Op.in]: userIds }
      }
    });
    
    // 合并用户信息和联系人状态
    const usersWithStatus = users.map(user => {
      const contact = existingContacts.find(c => c.contactId === user.id);
      return {
        ...user.toJSON(),
        contactStatus: contact?.status || null
      };
    });
    
    res.json({
      users: usersWithStatus,
      total: usersWithStatus.length
    });
  } catch (error) {
    console.error('搜索用户失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};

/**
 * 更新联系人备注
 */
export const updateContactAlias = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { contactId } = req.params;
    const { alias } = req.body;
    const userId = req.user?.id;
    
    if (!userId) {
      return res.status(401).json({ error: '用户未认证' });
    }
    
    // 查找联系人关系
    const contact = await Contact.findOne({
      where: {
        userId,
        contactId,
        status: ContactStatus.ACCEPTED
      }
    });
    
    if (!contact) {
      return res.status(404).json({ error: '联系人关系不存在' });
    }
    
    // 更新备注
    contact.alias = alias?.trim() || null;
    await contact.save();
    
    res.json({
      message: '联系人备注已更新',
      contact
    });
  } catch (error) {
    console.error('更新联系人备注失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
};
