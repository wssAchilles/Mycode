/**
 * 推荐系统权重配置
 * 借鉴 X 算法的加权评分思想
 * 
 * X 算法核心思想：
 * Final Score = Σ (weight_i × P(action_i))
 * - 正面行为使用正权重
 * - 负面行为使用负权重
 */

export const RECOMMENDATION_WEIGHTS = {
  // ==================== 正面信号权重 ====================
  
  /**
   * 回复权重 - 最强的正面信号
   * 用户主动回复表示高度兴趣
   */
  REPLY: 1.0,
  
  /**
   * 发送消息权重
   * 主动发起聊天是强烈的兴趣信号
   */
  MESSAGE_SENT: 0.8,
  
  /**
   * 阅读消息权重
   * 阅读消息表示一定程度的关注
   */
  MESSAGE_READ: 0.5,
  
  /**
   * 时效性权重
   * 最近的互动比久远的互动更重要
   */
  RECENCY: 0.7,
  
  /**
   * 共同联系人权重
   * 社交网络中的共同好友数量
   */
  MUTUAL_CONTACTS: 0.3,
  
  /**
   * 互动频率权重
   * 高频互动的联系人更重要
   */
  FREQUENCY: 0.6,
  
  /**
   * 双向互动权重
   * 双方都有互动比单向互动更有价值
   */
  BIDIRECTIONAL: 0.4,
  
  /**
   * 群组活跃度权重
   * 用户在群组中的参与程度
   */
  GROUP_ACTIVITY: 0.5,
  
  // ==================== 负面信号权重 ====================
  
  /**
   * 屏蔽权重 - 最强的负面信号
   * 直接设为极低分数
   */
  BLOCK: -100.0,
  
  /**
   * 静音权重
   * 静音表示用户想减少干扰
   */
  MUTE: -5.0,
  
  /**
   * 忽略消息权重
   * 长时间不阅读消息
   */
  IGNORE: -2.0,
  
  /**
   * 删除联系人权重
   */
  REMOVE_CONTACT: -8.0,
  
  /**
   * 隐藏会话权重
   */
  HIDE_CONVERSATION: -3.0,
  
  /**
   * 退出群组权重
   */
  LEAVE_GROUP: -6.0,
};

/**
 * 时间衰减配置
 * 用于计算 recency score
 */
export const TIME_DECAY = {
  /**
   * 衰减半衰期（天数）
   * 每过这么多天，分数衰减一半
   */
  HALF_LIFE_DAYS: 7,
  
  /**
   * 最大考虑天数
   * 超过这个时间的互动权重趋近于 0
   */
  MAX_DAYS: 90,
  
  /**
   * 最小衰减因子
   * 即使很久以前的互动也保留这个最小权重
   */
  MIN_DECAY: 0.1,
};

/**
 * 评分阈值配置
 */
export const SCORE_THRESHOLDS = {
  /**
   * 最小显示分数
   * 低于此分数的候选不显示
   */
  MIN_DISPLAY: -10.0,
  
  /**
   * 高优先级分数
   * 高于此分数的候选优先显示
   */
  HIGH_PRIORITY: 5.0,
  
  /**
   * 置顶分数阈值
   */
  PIN_THRESHOLD: 10.0,
};

/**
 * 候选源配置
 */
export const CANDIDATE_CONFIG = {
  /**
   * In-Network 候选数量上限
   * 来自已有联系人的会话
   */
  IN_NETWORK_LIMIT: 100,
  
  /**
   * Out-of-Network 候选数量上限
   * 推荐的新联系人/群组
   */
  OUT_OF_NETWORK_LIMIT: 20,
  
  /**
   * 最终返回结果数量
   */
  RESULT_SIZE: 50,
  
  /**
   * 共同好友推荐阈值
   * 至少有这么多共同好友才推荐
   */
  MIN_MUTUAL_FRIENDS: 2,
};

/**
 * 缓存配置
 */
export const CACHE_CONFIG = {
  /**
   * 推荐结果缓存时间（秒）
   */
  RECOMMENDATION_TTL: 300, // 5 分钟
  
  /**
   * 用户特征缓存时间（秒）
   */
  USER_FEATURES_TTL: 600, // 10 分钟
  
  /**
   * 统计数据缓存时间（秒）
   */
  STATS_TTL: 60, // 1 分钟
};

export default {
  RECOMMENDATION_WEIGHTS,
  TIME_DECAY,
  SCORE_THRESHOLDS,
  CANDIDATE_CONFIG,
  CACHE_CONFIG,
};
