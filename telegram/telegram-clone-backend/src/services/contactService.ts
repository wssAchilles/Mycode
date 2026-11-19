/**
 * ContactService - 联系人业务逻辑层
 * 封装联系人相关的所有业务逻辑
 */
import { Op } from 'sequelize';
import Contact, { ContactStatus } from '../models/Contact';
import User from '../models/User';
import { cacheService } from './cacheService';

// 联系人创建参数
interface CreateContactParams {
    userId: string;
    contactId: string;
    alias?: string;
    message?: string;
}

// 联系人信息
export interface ContactInfo {
    id: string;
    odId: string;
    username: string;
    email?: string;
    alias?: string;
    avatarUrl?: string | null;
    isOnline: boolean;
    lastSeen?: string;
    status: ContactStatus;
    createdAt: string;
}

class ContactService {
    /**
     * 发送联系人请求
     */
    async sendRequest(params: CreateContactParams): Promise<any> {
        const { userId, contactId, alias } = params;

        // 检查是否已存在关系
        const existing = await Contact.findOne({
            where: {
                [Op.or]: [
                    { userId, contactId },
                    { userId: contactId, contactId: userId },
                ],
            } as any,
        });

        if (existing) {
            const status = existing.status;
            if (status === ContactStatus.ACCEPTED) {
                throw new Error('已经是联系人了');
            }
            if (status === ContactStatus.PENDING) {
                throw new Error('请求正在等待处理');
            }
            if (status === ContactStatus.BLOCKED) {
                throw new Error('无法添加此用户');
            }
        }

        // 创建新请求
        const contact = await Contact.create({
            userId,
            contactId,
            alias,
            status: ContactStatus.PENDING,
        });

        return contact;
    }

    /**
     * 处理联系人请求
     */
    async handleRequest(
        requestId: string,
        userId: string,
        action: 'accept' | 'reject'
    ): Promise<any> {
        const contact = await Contact.findOne({
            where: {
                id: requestId,
                contactId: userId,
                status: ContactStatus.PENDING,
            },
        });

        if (!contact) {
            throw new Error('请求不存在或已处理');
        }

        if (action === 'accept') {
            await contact.accept();
        } else {
            await contact.reject();
        }

        // 清除缓存
        await this.invalidateContactsCache(userId);
        await this.invalidateContactsCache(contact.userId);

        return contact;
    }

    /**
     * 获取用户的联系人列表
     */
    async getContacts(userId: string): Promise<ContactInfo[]> {
        // 尝试从缓存获取基础资料，在线状态始终基于实时会话真源动态覆写
        const cacheKey = `contacts:${userId}`;
        const cached = await cacheService.get<ContactInfo[]>(cacheKey);
        if (cached) {
            const onlineMap = await cacheService.areUsersOnline(cached.map((contact) => contact.odId));
            return cached.map((contact) => ({
                ...contact,
                isOnline: onlineMap.get(contact.odId) ?? false,
            }));
        }

        const contacts = await Contact.findAll({
            where: {
                userId,
                status: ContactStatus.ACCEPTED,
            },
            include: [
                {
                    model: User,
                    as: 'contactUser',
                    attributes: ['id', 'username', 'email', 'avatarUrl'],
                },
            ],
        });

        const result: ContactInfo[] = contacts.map((c: any) => ({
            id: c.id,
            odId: c.contactId,
            username: c.contactUser?.username || '未知用户',
            email: c.contactUser?.email,
            alias: c.alias,
            avatarUrl: c.contactUser?.avatarUrl,
            isOnline: false, // 不将易失在线态静态固化在长缓存中
            status: c.status,
            createdAt: c.addedAt,
        }));

        // 基础资料缓存 30 分钟（在线状态置为 false，读取时实时合并）
        await cacheService.set(cacheKey, result, 1800);

        const onlineMap = await cacheService.areUsersOnline(result.map((contact) => contact.odId));
        for (const contact of result) {
            contact.isOnline = onlineMap.get(contact.odId) ?? false;
        }

        return result;
    }

    /**
     * 获取待处理的联系人请求
     */
    async getPendingRequests(userId: string): Promise<any[]> {
        const requests = await Contact.findAll({
            where: {
                contactId: userId,
                status: ContactStatus.PENDING,
            },
            include: [
                {
                    model: User,
                    as: 'requester',
                    attributes: ['id', 'username', 'email', 'avatarUrl'],
                },
            ],
        });

        return requests.map((r: any) => ({
            id: r.id,
            userId: r.userId,
            username: r.requester?.username || '未知用户',
            email: r.requester?.email,
            avatarUrl: r.requester?.avatarUrl,
            alias: r.alias,
            createdAt: r.addedAt,
        }));
    }

    /**
     * 更新联系人别名
     */
    async updateAlias(
        contactRecordId: string,
        userId: string,
        newAlias: string
    ): Promise<any> {
        const contact = await Contact.findOne({
            where: {
                id: contactRecordId,
                userId,
            },
        });

        if (!contact) {
            throw new Error('联系人不存在');
        }

        contact.alias = newAlias;
        await contact.save();

        await this.invalidateContactsCache(userId);

        return contact;
    }

    /**
     * 删除联系人
     */
    async deleteContact(contactRecordId: string, userId: string): Promise<boolean> {
        const contact = await Contact.findOne({
            where: {
                id: contactRecordId,
                userId,
            },
        });

        if (!contact) {
            return false;
        }

        const contactTargetId = contact.contactId;

        // 删除双向关系
        await Contact.destroy({
            where: {
                [Op.or]: [
                    { userId, contactId: contactTargetId },
                    { userId: contactTargetId, contactId: userId },
                ],
            } as any,
        });

        // 清除缓存
        await this.invalidateContactsCache(userId);
        await this.invalidateContactsCache(contactTargetId);

        return true;
    }

    /**
     * 屏蔽联系人
     */
    async blockContact(contactRecordId: string, userId: string): Promise<any> {
        const contact = await Contact.findOne({
            where: {
                id: contactRecordId,
                userId,
            },
        });

        if (!contact) {
            throw new Error('联系人不存在');
        }

        await contact.block();
        await this.invalidateContactsCache(userId);

        return contact;
    }

    /**
     * 清除联系人缓存
     */
    private async invalidateContactsCache(userId: string): Promise<void> {
        await cacheService.delete(`contacts:${userId}`);
    }
}

// 导出单例
export const contactService = new ContactService();
export default contactService;
