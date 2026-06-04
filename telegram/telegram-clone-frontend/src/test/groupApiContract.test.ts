import { beforeEach, describe, expect, it, vi } from 'vitest';

const axiosMocks = vi.hoisted(() => {
  const requestUse = vi.fn();
  const responseUse = vi.fn();
  const get = vi.fn();

  return {
    get,
    instance: {
      get,
      post: vi.fn(),
      put: vi.fn(),
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
});
