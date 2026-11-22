import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosMocks = vi.hoisted(() => {
  const requestUse = vi.fn();
  const responseUse = vi.fn();
  const get = vi.fn();
  const post = vi.fn();
  const put = vi.fn();

  return {
    get,
    post,
    put,
    instance: {
      get,
      post,
      put,
      delete: vi.fn(),
      interceptors: {
        request: { use: requestUse },
        response: { use: responseUse },
      },
    },
  };
});

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => axiosMocks.instance),
    post: vi.fn(),
  },
}));

import { groupAPI } from '../services/apiClient';

describe('groupAPI contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('unwraps the standard success envelope for group details', async () => {
    const details = {
      group: {
        id: 'group-1',
        name: 'Demo Product Review',
      },
      members: [{ id: 'member-1', userId: 'user-1' }],
      memberCount: 1,
    };

    axiosMocks.get.mockResolvedValue({
      data: {
        success: true,
        data: details,
      },
    });

    await expect(groupAPI.getGroupDetails('group-1')).resolves.toEqual(details);
  });

  it('extracts nested backend error messages instead of throwing [object Object]', async () => {
    const axiosLikeError = {
      response: {
        status: 403,
        data: {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: '您不是该群组的成员',
          },
        },
      },
    };

    axiosMocks.get.mockRejectedValueOnce(axiosLikeError);
    await expect(groupAPI.getGroupDetails('group-1')).rejects.toThrow('您不是该群组的成员');
  });

  it('uploads group avatar via FormData to /api/groups/avatar and unwraps avatarUrl', async () => {
    const file = new File(['avatar-bytes'], 'team-avatar.webp', { type: 'image/webp' });
    axiosMocks.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: {
          avatarUrl: '/api/public/space/uploads/team-avatar.webp',
        },
      },
    });

    await expect(groupAPI.uploadGroupAvatar(file)).resolves.toBe(
      '/api/public/space/uploads/team-avatar.webp',
    );
    expect(axiosMocks.post).toHaveBeenCalledTimes(1);
    const [url, payload] = axiosMocks.post.mock.calls[0];
    expect(url).toBe('/api/groups/avatar');
    expect(payload).toBeInstanceOf(FormData);
    expect((payload as FormData).get('avatar')).toBe(file);
  });

  it('forwards full group creation options including avatarUrl, type, and maxMembers', async () => {
    axiosMocks.post.mockResolvedValueOnce({
      data: {
        success: true,
        data: { group: { id: 'group-2', name: 'Core Team' } },
      },
    });

    const createPayload = {
      name: 'Core Team',
      description: 'Weekly sync',
      type: 'public' as const,
      maxMembers: 500,
      avatarUrl: '/api/public/space/uploads/core.webp',
    };
    await expect(groupAPI.createGroup(createPayload)).resolves.toEqual({
      success: true,
      data: { group: { id: 'group-2', name: 'Core Team' } },
    });
    expect(axiosMocks.post).toHaveBeenCalledWith('/api/groups', createPayload);
  });

  it('forwards avatarUrl (including null reset), type, and maxMembers on updateGroup', async () => {
    axiosMocks.put.mockResolvedValueOnce({
      data: {
        success: true,
        data: { group: { id: 'group-2', type: 'private', maxMembers: 100, avatarUrl: null } },
      },
    });

    const updatePayload = {
      name: 'Core Team Updated',
      description: 'Updated rules',
      type: 'private' as const,
      maxMembers: 100,
      avatarUrl: null,
    };
    await expect(groupAPI.updateGroup('group-2', updatePayload)).resolves.toEqual({
      success: true,
      data: { group: { id: 'group-2', type: 'private', maxMembers: 100, avatarUrl: null } },
    });
    expect(axiosMocks.put).toHaveBeenCalledWith('/api/groups/group-2', updatePayload);
  });
});
