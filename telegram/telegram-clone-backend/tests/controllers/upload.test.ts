import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Op } from 'sequelize';

vi.mock('../../src/models/Post', () => ({
  default: { exists: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../src/models/SpaceProfile', () => ({
  default: { exists: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../src/models/User', () => ({
  default: { findOne: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../src/models/Group', () => ({
  default: { findOne: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../src/models/NewsArticle', () => ({
  default: { findOne: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../src/models/SpaceUpload', () => ({
  default: { findOne: vi.fn().mockResolvedValue(null) },
}));

vi.mock('../../src/utils/logger', () => ({
  createChildLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('uploadController isSpacePublicAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows active group avatars without restricting to public group type', async () => {
    const Group = (await import('../../src/models/Group')).default;
    (Group.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ id: 'group-private-1' });

    const { isSpacePublicAsset } = await import('../../src/controllers/uploadController');
    const filename = 'f143b93b-466b-474e-ae6b-a251725c6036.webp';

    await expect(isSpacePublicAsset(filename)).resolves.toBe(true);
    expect(Group.findOne).toHaveBeenCalledWith({
      where: {
        isActive: true,
        avatarUrl: { [Op.like]: `%${filename}%` },
      },
      attributes: ['id'],
    });
  });

  it('denies unreferenced asset filenames when no model matches', async () => {
    const { isSpacePublicAsset } = await import('../../src/controllers/uploadController');
    await expect(isSpacePublicAsset('unreferenced-file.webp')).resolves.toBe(false);
  });
});
