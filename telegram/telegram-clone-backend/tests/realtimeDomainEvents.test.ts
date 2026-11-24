import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  emitRealtimeToUserMock,
  emitRealtimeToUsersMock,
  emitRealtimeToRoomMock,
  appendUpdateMock,
  appendUpdatesMock,
  findAllGroupMembersMock,
} = vi.hoisted(() => ({
  emitRealtimeToUserMock: vi.fn(),
  emitRealtimeToUsersMock: vi.fn(),
  emitRealtimeToRoomMock: vi.fn(),
  appendUpdateMock: vi.fn().mockResolvedValue(1),
  appendUpdatesMock: vi.fn().mockResolvedValue(undefined),
  findAllGroupMembersMock: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/services/socketRegistry', () => ({
  getSocketService: () => ({
    emitRealtimeToUser: emitRealtimeToUserMock,
    emitRealtimeToUsers: emitRealtimeToUsersMock,
    emitRealtimeToRoom: emitRealtimeToRoomMock,
  }),
}));

vi.mock('../src/services/updateService', () => ({
  updateService: {
    appendUpdate: appendUpdateMock,
    appendUpdates: appendUpdatesMock,
  },
}));

vi.mock('../src/models/GroupMember', () => ({
  default: {
    findAll: findAllGroupMembersMock,
  },
  MemberStatus: {
    ACTIVE: 'active',
    MUTED: 'muted',
    BANNED: 'banned',
    LEFT: 'left',
  },
}));

import {
  broadcastContactEvent,
  broadcastMessageDeleted,
  broadcastMessageEdited,
  broadcastSelfReadSync,
  broadcastSocialNotification,
} from '../src/services/realtimeEvents';

describe('领域实时事件广播器 (Phase A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('联系人申请/同意/拒绝均双端写入 UpdateLog 并推向受影响在线用户', async () => {
    await broadcastContactEvent({
      deliveries: [
        {
          userId: 'user-b',
          payload: {
            action: 'request_received',
            actorId: 'user-a',
            requestId: 'req-1',
            userId: 'user-a',
            contactId: 'user-b',
            request: {
              id: 'req-1',
              userId: 'user-a',
              username: 'alice',
              status: 'pending',
            },
          },
        },
        {
          userId: 'user-a',
          payload: {
            action: 'request_sent',
            actorId: 'user-a',
            requestId: 'req-1',
            userId: 'user-a',
            contactId: 'user-b',
            sentRequest: {
              id: 'req-1',
              contactId: 'user-b',
              username: 'bob',
            },
          },
        },
      ],
    });

    expect(appendUpdateMock).toHaveBeenCalledTimes(2);
    expect(appendUpdateMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: 'user-b',
        type: 'contact_change',
        chatId: 'contacts',
        payload: expect.objectContaining({ action: 'request_received', requestId: 'req-1' }),
      }),
    );
    expect(appendUpdateMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: 'user-a',
        type: 'contact_change',
        chatId: 'contacts',
        payload: expect.objectContaining({ action: 'request_sent', requestId: 'req-1' }),
      }),
    );

    expect(emitRealtimeToUserMock).toHaveBeenCalledTimes(2);
    expect(emitRealtimeToUserMock).toHaveBeenNthCalledWith(
      1,
      'user-b',
      expect.objectContaining({
        type: 'contactUpdate',
        payload: expect.objectContaining({ action: 'request_received', requestId: 'req-1' }),
      }),
    );
    expect(emitRealtimeToUserMock).toHaveBeenNthCalledWith(
      2,
      'user-a',
      expect.objectContaining({
        type: 'contactUpdate',
        payload: expect.objectContaining({ action: 'request_sent', requestId: 'req-1' }),
      }),
    );
  });

  it('消息编辑推向私聊双方，撤回推向群组房间并写 UpdateLog', async () => {
    await broadcastMessageEdited(
      {
        _id: 'msg-private-1',
        chatId: 'p:user-1:user-2',
        chatType: 'private',
        sender: 'user-1',
        receiver: 'user-2',
        seq: 12,
        content: '修改后的消息内容',
        editedAt: new Date('2026-11-24T12:00:00Z'),
      },
      'user-1',
    );

    expect(appendUpdatesMock).toHaveBeenCalledWith(
      ['user-1', 'user-2'],
      expect.objectContaining({
        type: 'message_edit',
        chatId: 'p:user-1:user-2',
        seq: 12,
        messageId: 'msg-private-1',
      }),
    );
    expect(emitRealtimeToUsersMock).toHaveBeenCalledWith(
      ['user-1', 'user-2'],
      expect.objectContaining({
        type: 'messageMutation',
        payload: expect.objectContaining({
          action: 'edited',
          messageId: 'msg-private-1',
          content: '修改后的消息内容',
        }),
      }),
    );

    vi.clearAllMocks();
    findAllGroupMembersMock.mockResolvedValueOnce([{ userId: 'u1' }, { userId: 'u2' }]);

    await broadcastMessageDeleted(
      {
        _id: 'msg-group-1',
        chatId: 'g:grp-9',
        chatType: 'group',
        isGroupChat: true,
        groupId: 'grp-9',
        sender: 'u1',
        seq: 88,
      },
      'u1',
    );

    expect(appendUpdatesMock).toHaveBeenCalledWith(
      ['u1', 'u2'],
      expect.objectContaining({
        type: 'message_delete',
        chatId: 'g:grp-9',
        seq: 88,
        messageId: 'msg-group-1',
      }),
    );
    expect(emitRealtimeToRoomMock).toHaveBeenCalledWith(
      'grp-9',
      expect.objectContaining({
        type: 'messageMutation',
        payload: expect.objectContaining({
          action: 'deleted',
          chatId: 'g:grp-9',
          messageId: 'msg-group-1',
        }),
      }),
    );
  });

  it('社交通知过滤自操作并将真实互动推送至目标作者', () => {
    broadcastSocialNotification({
      recipientId: 'author-1',
      actor: { id: 'author-1', username: 'self' },
      action: 'like',
      postId: 'post-1',
    });
    expect(emitRealtimeToUserMock).not.toHaveBeenCalled();

    broadcastSocialNotification({
      recipientId: 'author-1',
      actor: { id: 'fan-2', username: 'alice', avatarUrl: '/avatar.png' },
      action: 'comment',
      postId: 'post-1',
      commentId: 'cmt-1',
      previewText: '写得太好了',
    });

    expect(emitRealtimeToUserMock).toHaveBeenCalledWith(
      'author-1',
      expect.objectContaining({
        type: 'socialNotification',
        payload: expect.objectContaining({
          action: 'comment',
          recipientId: 'author-1',
          postId: 'post-1',
          commentId: 'cmt-1',
          previewText: '写得太好了',
        }),
      }),
    );
  });

  it('多端已读状态同步向当前用户推进 syncState', () => {
    broadcastSelfReadSync('user-555', 'p:user-555:user-666', 45);

    expect(emitRealtimeToUserMock).toHaveBeenCalledWith(
      'user-555',
      expect.objectContaining({
        type: 'syncState',
        payload: expect.objectContaining({
          action: 'chat_read',
          userId: 'user-555',
          chatId: 'p:user-555:user-666',
          seq: 45,
        }),
      }),
    );
  });
});
