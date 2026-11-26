/**
 * Space 跨路由滚动位置记忆模块
 * 同时维护内存与 sessionStorage，保证从动态详情/个人主页返回信息流时不回顶
 */
const STORAGE_KEY = 'tg:space:scroll-memory:v1';
const memoryMap = new Map<string, number>();
let hydrated = false;

function ensureHydrated(): void {
    if (hydrated || typeof window === 'undefined') return;
    hydrated = true;
    try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (!parsed || typeof parsed !== 'object') return;
        for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
                memoryMap.set(key, value);
            }
        }
    } catch {
        // 忽略存储解析异常
    }
}

function flushToSession(): void {
    if (typeof window === 'undefined') return;
    try {
        const obj: Record<string, number> = {};
        memoryMap.forEach((value, key) => {
            obj[key] = Math.round(value);
        });
        window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch {
        // 忽略存储配额异常
    }
}

export function buildSpaceScrollKey(section: string, inNetworkOnly?: boolean): string {
    if (section === 'home') {
        return `home:${inNetworkOnly ? 'friends' : 'all'}`;
    }
    return section;
}

export function readSpaceScrollPosition(key: string): number {
    ensureHydrated();
    return memoryMap.get(key) ?? 0;
}

export function saveSpaceScrollPosition(key: string, scrollTop: number): void {
    ensureHydrated();
    const safeTop = Number.isFinite(scrollTop) && scrollTop > 0 ? Math.round(scrollTop) : 0;
    memoryMap.set(key, safeTop);
    flushToSession();
}

export function clearSpaceScrollMemory(): void {
    memoryMap.clear();
    hydrated = true;
    if (typeof window !== 'undefined') {
        try {
            window.sessionStorage.removeItem(STORAGE_KEY);
        } catch {
            // 忽略异常
        }
    }
}
