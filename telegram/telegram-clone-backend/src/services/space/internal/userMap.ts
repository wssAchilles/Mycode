/**
 * Shared user lookup for Space domain.
 * Extracted verbatim from spaceService.
 */
import User from '../../../models/User';

export type SpaceUserBrief = {
    id: string;
    username: string;
    avatarUrl?: string | null;
    isOnline?: boolean | null;
};

export async function getUserMap(userIds: string[]): Promise<Map<string, SpaceUserBrief>> {
    const isUuid = (value: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    const uniqueIds = Array.from(new Set(userIds.filter((id) => id && isUuid(id))));
    if (uniqueIds.length === 0) return new Map();

    const users = await User.findAll({
        where: { id: uniqueIds },
        attributes: ['id', 'username', 'avatarUrl', 'isOnline'],
    });

    const map = new Map<string, SpaceUserBrief>();
    users.forEach((u) => {
        map.set(u.id, {
            id: u.id,
            username: u.username,
            avatarUrl: u.avatarUrl,
            isOnline: u.isOnline,
        });
    });
    return map;
}
