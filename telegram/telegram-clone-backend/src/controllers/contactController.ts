import { Request, Response } from 'express';
import Contact, { ContactStatus } from '../models/Contact';
import User from '../models/User';
import { Op } from 'sequelize';
import ChatCounter from '../models/ChatCounter';
import ChatMemberState from '../models/ChatMemberState';
import Message from '../models/Message';
import { waitForMongoReady } from '../config/db';
import { buildPrivateChatId } from '../utils/chat';
import { createChildLogger } from '../utils/logger';
import { sendSuccess, sendCreated, errors } from '../utils/apiResponse';
const log = createChildLogger('controllers:contactController');

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
      return errors.unauthorized(res);
    }

    if (!contactId) {
      return errors.badRequest(res, '联系人 ID 不能为空');
    }

    // 不能添加自己为联系人
    if (userId === contactId) {
      return errors.badRequest(res, '不能添加自己为联系人');
    }

    // 验证联系人用户是否存在
    const contactUser = await User.findByPk(contactId);
    if (!contactUser) {
      return errors.notFound(res, '用户');
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
        return errors.conflict(res, '该用户已经是您的联系人');
      }
      if (existingContact.status === ContactStatus.PENDING) {
        return errors.conflict(res, '联系人请求已发送，请等待对方确认');
      }
      if (existingContact.status === ContactStatus.BLOCKED) {
        return errors.conflict(res, '您已被该用户屏蔽');
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
    
    sendCreated(res, { contact: contactWithUser }, '联系人请求已发送');
  } catch (error) {
    log.error({ err: error }, '添加联系人失败');
    errors.internal(res);
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
      return errors.unauthorized(res);
    }

    let mongoReady = true;
    try {
      await waitForMongoReady(8000);
    } catch {
      mongoReady = false;
      log.warn('Mongo 未就绪，联系人最后消息/未读数将暂时为空');
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

    const contactChatIds = contacts.map((contact: any) => ({
      contactId: String(contact.contactId),
      chatId: buildPrivateChatId(userId, String(contact.contactId)),
    }));

    const counterMap = new Map<string, number>();
    const stateMap = new Map<string, number>();
    const lastMessageMap = new Map<string, any>();

    if (mongoReady && contactChatIds.length > 0) {
      const chatIds = contactChatIds.map((item) => item.chatId);
      const [counters, states, lastMessagesAgg] = await Promise.all([
        ChatCounter.find({ _id: { $in: chatIds } }).lean(),
        ChatMemberState.find({ chatId: { $in: chatIds }, userId }).lean(),
        Message.aggregate([
          { $match: { chatId: { $in: chatIds }, deletedAt: null } },
          { $sort: { seq: -1, timestamp: -1 } },
          { $group: { _id: '$chatId', doc: { $first: '$$ROOT' } } }
        ]),
      ]);

      counters.forEach((counter: any) => {
        counterMap.set(counter._id, counter.seq || 0);
      });
      states.forEach((state: any) => {
        stateMap.set(state.chatId, state.lastReadSeq || 0);
      });

      const senderIds = Array.from(new Set(lastMessagesAgg.map((row: any) => row?.doc?.sender).filter(Boolean)));
      const senderUsers = senderIds.length
        ? await User.findAll({ where: { id: senderIds }, attributes: ['id', 'username'] })
        : [];
      const senderNameMap = new Map(senderUsers.map((user: any) => [user.id, user.username]));

      lastMessagesAgg.forEach((row: any) => {
        if (!row?.doc) return;
        const doc = row.doc;
        lastMessageMap.set(row._id, {
          id: doc._id?.toString?.() || doc._id,
          content: doc.content,
          timestamp: doc.timestamp,
          senderId: doc.sender,
          senderUsername: senderNameMap.get(doc.sender) || '未知用户',
          type: doc.type || 'text',
          seq: doc.seq,
          chatId: doc.chatId,
        });
      });
    }

    const enrichedContacts = contacts.map((contact: any) => {
      const chatId = buildPrivateChatId(userId, String(contact.contactId));
      const latestSeq = counterMap.get(chatId) || 0;
      const lastReadSeq = stateMap.get(chatId) || 0;
      const unreadCount = Math.max(latestSeq - lastReadSeq, 0);
      return {
        ...contact.toJSON(),
        lastMessage: lastMessageMap.get(chatId) || null,
        unreadCount,
      };
    });
    
    sendSuccess(res, {
      contacts: enrichedContacts,
      total: enrichedContacts.length
    });
  } catch (error) {
    log.error({ err: error }, '获取联系人列表失败');
    errors.internal(res);
  }
};

/**
 * 获取待处理的联系人请求
 */
export const getPendingRequests = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return errors.unauthorized(res);
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
    
    sendSuccess(res, {
      requests: pendingRequests,
      total: pendingRequests.length
    });
  } catch (error) {
    log.error({ err: error }, '获取待处理请求失败');
    errors.internal(res);
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
      return errors.unauthorized(res);
    }

    if (!['accept', 'reject'].includes(action)) {
      return errors.badRequest(res, '无效的操作类型');
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
      return errors.notFound(res, '联系人请求');
    }
    
    if (action === 'accept') {
      // 接受请求
      await contactRequest.accept();

      sendSuccess(res, { contact: contactRequest }, { message: '联系人请求已接受' });
    } else {
      // 拒绝请求
      await contactRequest.reject();

      sendSuccess(res, { contact: contactRequest }, { message: '联系人请求已拒绝' });
    }
  } catch (error) {
    log.error({ err: error }, '处理联系人请求失败');
    errors.internal(res);
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
      return errors.unauthorized(res);
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
      return errors.notFound(res, '联系人关系');
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
    
    sendSuccess(res, null, { message: '联系人已删除' });
  } catch (error) {
    log.error({ err: error }, '删除联系人失败');
    errors.internal(res);
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
      return errors.unauthorized(res);
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
    
    sendSuccess(res, { contact }, { message: '联系人已屏蔽' });
  } catch (error) {
    log.error({ err: error }, '屏蔽联系人失败');
    errors.internal(res);
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
      return errors.unauthorized(res);
    }

    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return errors.badRequest(res, '搜索关键词至少需要2个字符');
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
    
    sendSuccess(res, {
      users: usersWithStatus,
      total: usersWithStatus.length
    });
  } catch (error) {
    log.error({ err: error }, '搜索用户失败');
    errors.internal(res);
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
      return errors.unauthorized(res);
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
      return errors.notFound(res, '联系人关系');
    }
    
    // 更新备注
    contact.alias = alias?.trim() || null;
    await contact.save();
    
    sendSuccess(res, { contact }, { message: '联系人备注已更新' });
  } catch (error) {
    log.error({ err: error }, '更新联系人备注失败');
    errors.internal(res);
  }
};
