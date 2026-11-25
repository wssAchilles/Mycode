/**
 * 确定性伪随机数与概率分布采样引擎（Mulberry32）
 *
 * 借鉴开源图基准（LDBC SNB Datagen / GraphWorld）：
 * - Zipf 幂律分布（模拟大V粉丝与爆款动态长尾分布）
 * - Hawkes / Flashmob 爆发窗口采样（模拟热点发布后集中互动再指数衰减）
 * - 正态 / 对数正态 / 加权无放回抽样
 */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 1;
  }

  /** 返回 [0, 1) 区间均匀分布随机数 */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** 返回 [min, max] 整数 */
  int(min: number, max: number): number {
    if (max <= min) return min;
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** 返回 [min, max) 浮点数 */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** 伯努利试验 */
  chance(probability: number): boolean {
    if (probability <= 0) return false;
    if (probability >= 1) return true;
    return this.next() < probability;
  }

  /** 从数组中随机选 1 个元素 */
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Box-Muller 标准正态分布 */
  gaussian(mean: number = 0, stdDev: number = 1): number {
    const u1 = Math.max(1e-9, this.next());
    const u2 = this.next();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * stdDev;
  }

  /** 对数正态分布，适合建模阅读时长、关注数量、热度基数 */
  logNormal(mu: number, sigma: number): number {
    return Math.exp(this.gaussian(mu, sigma));
  }

  /**
   * 离散 Zipf 分布采样（返回 0 .. n-1 的下标）
   * exponent 典型取 1.05 ~ 1.45，越大头部集中效应越强
   */
  zipfIndex(n: number, exponent: number = 1.15): number {
    if (n <= 1) return 0;
    // 基于连续逆变换近似生成高效离散幂律排名（无需 O(N) 建表）
    const u = Math.max(1e-7, this.next());
    const s = Math.max(1.01, exponent);
    const maxRank = n;
    // p(k) ~ k^(-s) -> 逆 CDF 采样
    const ratio = (Math.pow(maxRank + 0.5, 1 - s) - Math.pow(0.5, 1 - s)) * u + Math.pow(0.5, 1 - s);
    const rank = Math.floor(Math.pow(Math.max(1e-9, ratio), 1 / (1 - s)) - 0.5);
    return Math.min(n - 1, Math.max(0, rank));
  }

  /** 按权重随机抽取 1 个元素 */
  weightedPick<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (let i = 0; i < weights.length; i += 1) {
      total += Math.max(0, weights[i]);
    }
    if (total <= 0) {
      return this.pick(items);
    }
    let threshold = this.next() * total;
    for (let i = 0; i < items.length; i += 1) {
      threshold -= Math.max(0, weights[i]);
      if (threshold <= 0) {
        return items[i];
      }
    }
    return items[items.length - 1];
  }

  /** 无放回随机抽取 k 个元素（Fisher-Yates 部分洗牌） */
  sampleWithoutReplacement<T>(items: readonly T[], count: number): T[] {
    if (count <= 0 || items.length === 0) return [];
    const copy = items.slice();
    const limit = Math.min(count, copy.length);
    for (let i = 0; i < limit; i += 1) {
      const swapIdx = this.int(i, copy.length - 1);
      const tmp = copy[i];
      copy[i] = copy[swapIdx];
      copy[swapIdx] = tmp;
    }
    return copy.slice(0, limit);
  }

  /**
   * 模拟 Flashmob / Hawkes 过程时间偏移：
   * 帖子发布后到 now 之间采样互动时间，爆款贴更多集中在发布后前 6 小时
   */
  sampleEngagementTimestamp(postCreatedAt: Date, nowMs: number, isFlashmob: boolean): Date {
    const postMs = postCreatedAt.getTime();
    const spanMs = Math.max(60_000, nowMs - postMs);
    const halfLifeHours = isFlashmob ? 4.5 : 28;
    const halfLifeMs = halfLifeHours * 3600 * 1000;

    // 截断指数分布采样，确保大量互动发生在发布早期窗口
    const lambda = Math.LN2 / halfLifeMs;
    const maxOffset = Math.min(spanMs, (isFlashmob ? 72 : 360) * 3600 * 1000);
    const expMax = 1 - Math.exp(-lambda * maxOffset);
    const u = Math.min(0.999999, Math.max(1e-7, this.next()) * expMax);
    const offsetMs = Math.min(spanMs - 1000, Math.max(30_000, Math.round(-Math.log(1 - u) / lambda)));
    return new Date(Math.min(nowMs - 5_000, postMs + offsetMs));
  }
}
