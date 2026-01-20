/**
 * RecommendationService - 推荐系统核心服务
 * 
 * 借鉴 X 算法的核心思想：
 * 1. 无手工特征工程 - 从用户行为中学习
 * 2. 多行为预测 - 预测多种互动类型
 * 3. 加权评分 - 正面行为正权重，负面行为负权重
 * 4. 候选隔离 - 每个候选独立评分
 */

import { 
  UserInteraction,
  UserInteractionStats, 
  IUserInteractionStats,
  InteractionType,
  TargetType 
} from '../models/UserInteraction';
import { Contact, ContactStatus } from '../models/Contact';
import { Group } from '../models/Group';
import Message from '../models/Message';
import { cacheService } from './cacheService';
import {
  RECOMMENDATION_WEIGHTS as WEIGHTS,
  TIME_DECAY,
  SCORE_THRESHOLDS,
  CANDIDATE_CONFIG,
  CACHE_CONFIG,
} from '../config/recommendationWeights';

// ==================== 类型定义 ====================

/**
 * 推荐候选项
 */
interface RecommendationCandidate {
  id: string;
  type: TargetType;
  
  // 评分组件
  scores: {
    replyScore: number;
    messageScore: number;
    readScore: number;
    recencyScore: number;
    mutualScore: number;
    frequencyScore: number;
    bidirectionalScore: number;
    
    // 负面分数
    ignoreScore: number;
    blockScore: number;
    muteScore: number;
  };
  
  // 最终分数
  finalScore: number;
  
  // 元数据
  metadata: {
    lastInteractionAt?: Date;
    messagesSent?: number;
    messagesReceived?: number;
    unreadCount?: number;
    mutualContacts?: number;
  };
}

/**
 * 用户行为序列
 * 类似 X 算法的 UserActionSequence
 */
interface UserActionSequence {
  userId: string;
  recentInteractions: Array<{
    targetId: string;
    targetType: TargetType;
    interactionType: InteractionType;
    timestamp: Date;
  }>;
  blockedIds: Set<string>;
  mutedIds: Set<string>;
  contactIds: Set<string>;
}

/**
 * 推荐请求参数
 */
interface RecommendationRequest {
  userId: string;
  targetType?: TargetType;
  limit?: number;
  includeOutOfNetwork?: boolean;
}

/**
 * 推荐响应
 */
interface RecommendationResponse {
  candidates: RecommendationCandidate[];
  totalCount: number;
  cached: boolean;
  generatedAt: Date;
}

// ==================== 推荐服务实现 ====================

class RecommendationService {
  
  /**
   * 获取推荐列表
   * 类似 X 算法的 Home Mixer Pipeline
   */
  async getRecommendations(request: RecommendationRequest): Promise<RecommendationResponse> {
    const { userId, targetType, limit = CANDIDATE_CONFIG.RESULT_SIZE } = request;
    
    // 1. 尝试从缓存获取
    const cacheKey = `recommendations:${userId}:${targetType || 'all'}:${limit}`;
    const cached = await cacheService.get<RecommendationResponse>(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
    
    // 2. 获取用户行为序列（Query Hydration）
    const userSequence = await this.getUserActionSequence(userId);
    
    // 3. 获取候选源（Candidate Sourcing）
    const candidates = await this.fetchCandidates(userId, userSequence, targetType);
    
    // 4. 过滤（Filtering）
    const filteredCandidates = this.filterCandidates(candidates, userSequence);
    
    // 5. 评分（Scoring）
    const scoredCandidates = await this.scoreCandidates(filteredCandidates, userSequence);
    
    // 6. 选择（Selection）
    const selectedCandidates = this.selectTopCandidates(scoredCandidates, limit);
    
    // 7. 构建响应
    const response: RecommendationResponse = {
      candidates: selectedCandidates,
      totalCount: selectedCandidates.length,
      cached: false,
      generatedAt: new Date(),
    };
    
    // 8. 缓存结果
    await cacheService.set(cacheKey, response, CACHE_CONFIG.RECOMMENDATION_TTL);
    
    // 9. 异步更新缓存分数（Side Effect）
    this.updateCachedScores(userId, selectedCandidates).catch(console.error);
    
    return response;
  }
  
  /**
   * 获取用户行为序列
   * 类似 X 算法的 Query Hydration 阶段
   */
  private async getUserActionSequence(userId: string): Promise<UserActionSequence> {
    const cacheKey = `user_sequence:${userId}`;
    const cached = await cacheService.get<UserActionSequence>(cacheKey);
    if (cached) {
      // 恢复 Set 对象
      return {
        ...cached,
        blockedIds: new Set(cached.blockedIds),
        mutedIds: new Set(cached.mutedIds),
        contactIds: new Set(cached.contactIds),
      };
    }
    
    // 并行获取用户数据
    const [recentInteractions, blockedContacts, mutedStats, contacts] = await Promise.all([
      // 最近 30 天的互动
      UserInteraction.find({
        userId,
        timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      })
        .sort({ timestamp: -1 })
        .limit(500)
        .lean(),
      
      // 屏蔽列表
      Contact.findAll({
        where: { userId, status: ContactStatus.BLOCKED },
        attributes: ['contactId'],
      }),
      
      // 静音列表
      UserInteractionStats.find({
        userId,
        isMuted: true,
      }).select('targetId').lean(),
      
      // 联系人列表
      Contact.findAll({
        where: { userId, status: ContactStatus.ACCEPTED },
        attributes: ['contactId'],
      }),
    ]);
    
    const sequence: UserActionSequence = {
      userId,
      recentInteractions: recentInteractions.map((i: any) => ({
        targetId: i.targetId,
        targetType: i.targetType,
        interactionType: i.interactionType,
        timestamp: i.timestamp,
      })),
      blockedIds: new Set(blockedContacts.map(c => c.contactId)),
      mutedIds: new Set(mutedStats.map((s: any) => s.targetId)),
      contactIds: new Set(contacts.map(c => c.contactId)),
    };
    
    // 缓存用户序列
    await cacheService.set(cacheKey, {
      ...sequence,
      blockedIds: Array.from(sequence.blockedIds),
      mutedIds: Array.from(sequence.mutedIds),
      contactIds: Array.from(sequence.contactIds),
    }, CACHE_CONFIG.USER_FEATURES_TTL);
    
    return sequence;
  }
  
  /**
   * 获取候选源
   * 类似 X 算法的 Thunder (In-Network) + Phoenix Retrieval (Out-of-Network)
   */
  private async fetchCandidates(
    userId: string,
    userSequence: UserActionSequence,
    targetType?: TargetType
  ): Promise<RecommendationCandidate[]> {
    const candidates: RecommendationCandidate[] = [];
    
    // In-Network: 获取已有联系人的会话
    if (!targetType || targetType === TargetType.USER) {
      const inNetworkCandidates = await this.fetchInNetworkCandidates(userId, userSequence);
      candidates.push(...inNetworkCandidates);
    }
    
    // In-Network: 获取群组
    if (!targetType || targetType === TargetType.GROUP) {
      const groupCandidates = await this.fetchGroupCandidates(userId);
      candidates.push(...groupCandidates);
    }
    
    return candidates;
  }
  
  /**
   * 获取 In-Network 用户候选
   * 类似 X 的 Thunder 服务
   */
  private async fetchInNetworkCandidates(
    userId: string,
    userSequence: UserActionSequence
  ): Promise<RecommendationCandidate[]> {
    // 获取有互动历史的用户统计
    const stats = await UserInteractionStats.find({
      userId,
      targetType: TargetType.USER,
    })
      .sort({ lastInteractionAt: -1 })
      .limit(CANDIDATE_CONFIG.IN_NETWORK_LIMIT)
      .lean();
    
    // 同时获取联系人（确保联系人在列表中）
    const contactIds = Array.from(userSequence.contactIds);
    
    // 合并去重
    const candidateMap = new Map<string, any>();
    
    stats.forEach((s: any) => {
      candidateMap.set(s.targetId, s);
    });
    
    // 确保联系人也在候选中
    contactIds.forEach(contactId => {
      if (!candidateMap.has(contactId)) {
        candidateMap.set(contactId, {
          targetId: contactId,
          targetType: TargetType.USER,
          messagesSent: 0,
          messagesRead: 0,
          repliesCount: 0,
          lastInteractionAt: null,
        });
      }
    });
    
    return Array.from(candidateMap.values()).map((s: any) => this.createCandidate(s));
  }
  
  /**
   * 获取群组候选
   */
  private async fetchGroupCandidates(userId: string): Promise<RecommendationCandidate[]> {
    const stats = await UserInteractionStats.find({
      userId,
      targetType: TargetType.GROUP,
    })
      .sort({ lastInteractionAt: -1 })
      .limit(50)
      .lean();
    
    return stats.map((s: any) => this.createCandidate(s));
  }
  
  /**
   * 创建候选对象
   */
  private createCandidate(stats: any): RecommendationCandidate {
    return {
      id: stats.targetId,
      type: stats.targetType,
      scores: {
        replyScore: 0,
        messageScore: 0,
        readScore: 0,
        recencyScore: 0,
        mutualScore: 0,
        frequencyScore: 0,
        bidirectionalScore: 0,
        ignoreScore: 0,
        blockScore: 0,
        muteScore: 0,
      },
      finalScore: 0,
      metadata: {
        lastInteractionAt: stats.lastInteractionAt,
        messagesSent: stats.messagesSent || 0,
        mutualContacts: 0,
      },
    };
  }
  
  /**
   * 过滤候选
   * 类似 X 算法的 Filtering 阶段
   */
  private filterCandidates(
    candidates: RecommendationCandidate[],
    userSequence: UserActionSequence
  ): RecommendationCandidate[] {
    return candidates.filter(candidate => {
      // 过滤自己
      if (candidate.id === userSequence.userId) {
        return false;
      }
      
      // 过滤已屏蔽
      if (userSequence.blockedIds.has(candidate.id)) {
        return false;
      }
      
      return true;
    });
  }
  
  /**
   * 评分
   * 类似 X 算法的 Phoenix Scorer + Weighted Scorer
   */
  private async scoreCandidates(
    candidates: RecommendationCandidate[],
    userSequence: UserActionSequence
  ): Promise<RecommendationCandidate[]> {
    const now = Date.now();
    
    return Promise.all(candidates.map(async candidate => {
      const scores = candidate.scores;
      
      // 1. 计算时效性分数 (Recency Score)
      if (candidate.metadata.lastInteractionAt) {
        const daysSince = (now - new Date(candidate.metadata.lastInteractionAt).getTime()) 
          / (24 * 60 * 60 * 1000);
        scores.recencyScore = this.calculateRecencyScore(daysSince);
      }
      
      // 2. 计算消息频率分数
      const messageCount = candidate.metadata.messagesSent || 0;
      scores.messageScore = Math.min(messageCount / 100, 1); // 归一化到 0-1
      
      // 3. 统计互动历史
      const interactionStats = this.aggregateInteractions(candidate.id, userSequence);
      scores.replyScore = Math.min(interactionStats.replies / 50, 1);
      scores.frequencyScore = Math.min(interactionStats.total / 200, 1);
      
      // 4. 负面信号
      if (userSequence.mutedIds.has(candidate.id)) {
        scores.muteScore = 1;
      }
      
      // 5. 计算最终加权分数
      candidate.finalScore = this.calculateWeightedScore(scores);
      
      return candidate;
    }));
  }
  
  /**
   * 计算时效性分数
   * 使用指数衰减
   */
  private calculateRecencyScore(daysSince: number): number {
    if (daysSince > TIME_DECAY.MAX_DAYS) {
      return TIME_DECAY.MIN_DECAY;
    }
    
    const decay = Math.pow(0.5, daysSince / TIME_DECAY.HALF_LIFE_DAYS);
    return Math.max(decay, TIME_DECAY.MIN_DECAY);
  }
  
  /**
   * 聚合用户对特定目标的互动
   */
  private aggregateInteractions(
    targetId: string,
    userSequence: UserActionSequence
  ): { replies: number; messages: number; reads: number; total: number } {
    const result = { replies: 0, messages: 0, reads: 0, total: 0 };
    
    for (const interaction of userSequence.recentInteractions) {
      if (interaction.targetId === targetId) {
        result.total++;
        
        switch (interaction.interactionType) {
          case InteractionType.MESSAGE_REPLIED:
            result.replies++;
            break;
          case InteractionType.MESSAGE_SENT:
            result.messages++;
            break;
          case InteractionType.MESSAGE_READ:
            result.reads++;
            break;
        }
      }
    }
    
    return result;
  }
  
  /**
   * 计算加权分数
   * 核心算法：Final Score = Σ (weight_i × score_i)
   */
  private calculateWeightedScore(scores: RecommendationCandidate['scores']): number {
    const weightedScore = 
      // 正面信号
      scores.replyScore * WEIGHTS.REPLY +
      scores.messageScore * WEIGHTS.MESSAGE_SENT +
      scores.readScore * WEIGHTS.MESSAGE_READ +
      scores.recencyScore * WEIGHTS.RECENCY +
      scores.mutualScore * WEIGHTS.MUTUAL_CONTACTS +
      scores.frequencyScore * WEIGHTS.FREQUENCY +
      scores.bidirectionalScore * WEIGHTS.BIDIRECTIONAL +
      // 负面信号
      scores.ignoreScore * WEIGHTS.IGNORE +
      scores.blockScore * WEIGHTS.BLOCK +
      scores.muteScore * WEIGHTS.MUTE;
    
    return weightedScore;
  }
  
  /**
   * 选择 Top K 候选
   * 类似 X 算法的 Selector 阶段
   */
  private selectTopCandidates(
    candidates: RecommendationCandidate[],
    limit: number
  ): RecommendationCandidate[] {
    // 过滤低于阈值的候选
    const validCandidates = candidates.filter(
      c => c.finalScore >= SCORE_THRESHOLDS.MIN_DISPLAY
    );
    
    // 按分数排序
    validCandidates.sort((a, b) => b.finalScore - a.finalScore);
    
    // 返回 Top K
    return validCandidates.slice(0, limit);
  }
  
  /**
   * 更新缓存分数
   * 类似 X 算法的 Side Effect 阶段
   */
  private async updateCachedScores(
    userId: string,
    candidates: RecommendationCandidate[]
  ): Promise<void> {
    const updates = candidates.map(c => ({
      userId,
      targetId: c.id,
      targetType: c.type,
      score: c.finalScore,
    }));
    
    await (UserInteractionStats as any).updateCachedScores(updates);
  }
  
  // ==================== 公共 API ====================
  
  /**
   * 记录用户互动
   */
  async recordInteraction(
    userId: string,
    targetId: string,
    targetType: TargetType,
    interactionType: InteractionType,
    metadata?: any
  ): Promise<void> {
    await (UserInteraction as any).recordInteraction(
      userId,
      targetId,
      targetType,
      interactionType,
      metadata
    );
    
    // 清除相关缓存
    await cacheService.del(`recommendations:${userId}:all`);
    await cacheService.del(`user_sequence:${userId}`);
  }
  
  /**
   * 获取聊天列表排序
   * 主要用例：对 ChatList 进行智能排序
   */
  async getSortedChatList(userId: string, limit = 50): Promise<RecommendationCandidate[]> {
    const response = await this.getRecommendations({
      userId,
      targetType: TargetType.USER,
      limit,
    });
    
    return response.candidates;
  }
  
  /**
   * 获取群组推荐
   */
  async getGroupRecommendations(userId: string, limit = 20): Promise<RecommendationCandidate[]> {
    const response = await this.getRecommendations({
      userId,
      targetType: TargetType.GROUP,
      limit,
    });
    
    return response.candidates;
  }
}

// 导出单例
export const recommendationService = new RecommendationService();

export default recommendationService;
