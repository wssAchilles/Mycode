import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chatMemberStateFind: vi.fn(),
  chatMemberStateFindOneAndUpdate: vi.fn(),
  chatMemberStateCountDocuments: vi.fn(),
  messageFindOne: vi.fn(),
}));

vi.mock('../../src/models/ChatMemberState', () => ({
  default: {
    find: mocks.chatMemberStateFind,
    findOneAndUpdate: mocks.chatMemberStateFindOneAndUpdate,
    countDocuments: mocks.chatMemberStateCountDocuments,
  },
}));

vi.mock('../../src/models/Message', () => ({
  default: {
    findOne: mocks.messageFindOne,
  },
}));

import {
  advanceChatLastReadSeqWithResult,
  computeGroupReadCountAtSeq,
  projectMessagesWithReadState,
} from '../../src/utils/chatReadState';

describe('chatReadState 已读水位线与群聊精准计数', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('群聊投影按消息发送者排除本人并精确返回各消息的 readCount', async () => {
    // 成员读水位：userA(发消息者)读到5，userB读到4，userC读到2
    mocks.chatMemberStateFind.mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        { userId: 'userA', lastReadSeq: 5 },
        { userId: 'userB', lastReadSeq: 4 },
        { userId: 'userC', lastReadSeq: 2 },
      ]),
    });

    const { messages, readState } = await projectMessagesWithReadState({
      chatId: 'g:group1',
      chatType: 'group',
      currentUserId: 'userA',
      messages: [
        { id: 'm1', sender: 'userA', seq: 1, status: 'delivered' },
        { id: 'm2', sender: 'userA', seq: 3, status: 'delivered' },
        { id: 'm3', sender: 'userA', seq: 5, status: 'delivered' },
      ],
    });

    // seq=1: 除userA外，userB(4)和userC(2)都读了 => 2人
    expect(messages[0]).toMatchObject({ id: 'm1', status: 'read', readCount: 2 });
    // seq=3: 除userA外，仅userB(4)读了 => 1人
    expect(messages[1]).toMatchObject({ id: 'm2', status: 'read', readCount: 1 });
    // seq=5: 只有发消息者userA自己为5 => 0人已读，绝不误标read
    expect(messages[2]).toMatchObject({ id: 'm3', status: 'delivered' });
    expect(messages[2].readCount).toBeUndefined();
    expect(readState.readWatermarks).toEqual([
      { userId: 'userB', lastReadSeq: 4 },
      { userId: 'userC', lastReadSeq: 2 },
    ]);
  });

  it('computeGroupReadCountAtSeq 统计已读人数时排除目标消息发送者本人', async () => {
    mocks.messageFindOne.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ sender: 'userA' }),
    });
    mocks.chatMemberStateCountDocuments.mockResolvedValue(1);

    const count = await computeGroupReadCountAtSeq('g:group1', 5);

    expect(count).toBe(1);
    expect(mocks.chatMemberStateCountDocuments).toHaveBeenCalledWith({
      chatId: 'g:group1',
      userId: { $ne: 'userA' },
      lastReadSeq: { $gte: 5 },
    });
  });

  it('advanceChatLastReadSeqWithResult 精确返回推进前后水位线', async () => {
    mocks.chatMemberStateFindOneAndUpdate.mockReturnValue({
      lean: vi.fn().mockResolvedValue({ lastReadSeq: 3 }),
    });

    const res = await advanceChatLastReadSeqWithResult('p:userA:userB', 'userB', 7, {
      updateDeliveredSeq: true,
    });

    expect(res).toEqual({
      advanced: true,
      previousSeq: 3,
      nextSeq: 7,
    });
    expect(mocks.chatMemberStateFindOneAndUpdate).toHaveBeenCalledWith(
      { chatId: 'p:userA:userB', userId: 'userB' },
      { $max: { lastReadSeq: 7, lastDeliveredSeq: 7 }, $set: { lastSeenAt: expect.any(Date) } },
      { upsert: true, new: false },
    );
  });
});
