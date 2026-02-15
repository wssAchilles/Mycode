# Telegram Clone Backend — 完整项目研究报告

## 1. 项目概览

这是一个**工业级仿 Telegram 聊天应用后端**，使用 **TypeScript + Express.js** 构建。除核心即时通讯功能外，还包含社交动态 (Space)、AI 聊天 (Gemini)、新闻聚合、以及一套**像素级复刻 X/Twitter 推荐算法**的推荐系统。

---

## 2. 技术栈与依赖

### 2.1 核心框架
| 库 | 版本 | 用途 |
|---|---|---|
| express | 4.21.2 | Web 框架 |
| typescript | 5.6.3 | 类型系统 |
| socket.io | 4.8.1 | 实时通信 |
| bullmq | 5.66.5 | 消息队列 |

### 2.2 数据库
| 库 | 版本 | 用途 |
|---|---|---|
| mongoose | 8.16.5 | MongoDB ODM |
| sequelize | 6.37.7 | PostgreSQL ORM |
| ioredis | 5.6.1 | Redis 客户端 |

### 2.3 认证与安全
| 库 | 版本 | 用途 |
|---|---|---|
| jsonwebtoken | 9.0.2 | JWT 令牌 |
| bcryptjs | 2.4.3 | 密码哈希 |
| @privacyresearch/libsignal-protocol-typescript | 0.1.1 | Signal Protocol E2E 密钥管理 |
| zod | 4.3.6 | 运行时验证 |

### 2.4 文件存储
| 库 | 版本 | 用途 |
|---|---|---|
| @aws-sdk/client-s3 | 3.682.0 | AWS S3 对象存储 |
| multer | 1.4.5-lts.1 | 文件上传中间件 |
| sharp | 0.33.5 | 图片处理/缩略图 |
| iconv-lite | 0.6.3 | 中文文件名编码修正 |

### 2.5 AI 与 ML
| 库 | 版本 | 用途 |
|---|---|---|
| axios | 1.8.4 | 调用 Gemini API / ML 服务代理 |

### 2.6 监控与日志
| 库 | 版本 | 用途 |
|---|---|---|
| @sentry/node | 8.37.0 | 错误追踪 |
| morgan | 1.10.0 | HTTP 日志 |

### 2.7 其他
| 库 | 版本 | 用途 |
|---|---|---|
| node-cron | 4.2.1 | 定时任务 |
| uuid | 11.0.3 | UUID 生成 |
| cors | 2.8.5 | 跨域处理 |
| dotenv | 16.4.7 | 环境变量 |

### 2.8 开发依赖
ts-node, tsx, nodemon, @types/*, sequelize-cli

### 2.9 NPM Scripts
```json
{
  "start": "node dist/index.js",
  "dev": "tsx watch src/index.ts",
  "build": "tsc",
  "test": "jest --config jest.config.ts",
  "migrate:messages": "tsx src/scripts/migrateMessages.ts",
  "seed:clusters": "tsx src/scripts/seedClusters.ts",
  "seed:all": "tsx src/scripts/seedAll.ts",
  "clear:data": "tsx src/scripts/clearData.ts",
  "job:simclusters": "tsx src/scripts/runSimClusters.ts",
  "job:realgraph": "tsx src/scripts/runRealGraphDecay.ts",
  "job:backfill-timelines": "tsx src/scripts/backfillTimelines.ts",
  "report:recall-source": "tsx src/scripts/reportRecallSource.ts",
  "export:recsys-samples": "tsx src/scripts/exportRecsysSamples.ts"
}
```

---

## 3. 数据库架构 (三数据库架构)

### 3.1 PostgreSQL (Sequelize) — 关系型数据

#### User 用户表
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID (PK) | 主键 |
| username | STRING(50) | 唯一用户名 |
| password | STRING | bcrypt 哈希 |
| email | STRING | 可选邮箱 |
| avatarUrl | STRING | 头像 URL |
| lastSeen | DATE | 最后在线时间 |
| isOnline | BOOLEAN | 是否在线 |

#### Contact 联系人表
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID (PK) | 主键 |
| userId | UUID (FK→User) | 发起方 |
| contactId | UUID (FK→User) | 接收方 |
| status | ENUM | pending / accepted / rejected / blocked |
| alias | STRING | 备注名 |

#### Group 群组表
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID (PK) | 主键 |
| name | STRING(100) | 群名 |
| description | TEXT | 群描述 |
| ownerId | UUID (FK→User) | 群主 |
| type | ENUM | public / private |
| avatarUrl | STRING | 群头像 |
| maxMembers | INT(500) | 最大成员数 |
| memberCount | INT | 当前成员数 |
| isActive | BOOLEAN | 是否活跃 |

#### GroupMember 群成员表
| 字段 | 类型 | 说明 |
|---|---|---|
| groupId | UUID (FK→Group) | 群 ID |
| userId | UUID (FK→User) | 用户 ID |
| role | ENUM | owner / admin / member |
| status | ENUM | active / muted / banned / left |
| nickname | STRING | 群内昵称 |
| mutedUntil | DATE | 禁言截止 |
| invitedBy | UUID | 邀请者 |

#### UserKey Signal 密钥表
| 字段 | 类型 | 说明 |
|---|---|---|
| userId | UUID (FK→User) | 用户 ID |
| registrationId | INT | Signal 注册 ID |
| identityKey | TEXT | 身份公钥 |
| signedPreKey | TEXT | 签名预密钥 |
| signedPreKeySig | TEXT | 签名 |

#### OneTimePreKey 一次性预密钥表
| 字段 | 类型 | 说明 |
|---|---|---|
| userId | UUID (FK→User) | 用户 ID |
| keyId | INT | 密钥序号 |
| publicKey | TEXT | 公钥 (使用后即删除) |

#### NewsArticle 新闻文章表
| 字段 | 类型 | 说明 |
|---|---|---|
| id | UUID (PK) | 主键 |
| title | STRING(500) | 标题 |
| summary | TEXT | 摘要 |
| lead | STRING(300) | 导语 |
| source / sourceUrl / canonicalUrl | STRING | 来源信息 |
| publishedAt / fetchedAt | DATE | 发布/抓取时间 |
| language / country / category | STRING | 元数据 |
| hashUrl | STRING(64) | URL SHA256 (唯一去重) |
| clusterId | INT | 聚类 ID |
| keywords | ARRAY(STRING) | 关键词 |
| embedding | ARRAY(FLOAT) | 向量嵌入 |
| engagementScore / viewCount / clickCount / shareCount / dwellCount | FLOAT/INT | 互动指标 |
| coverImageUrl / contentPath | STRING | 封面/正文存储路径 |

#### NewsSource 新闻来源表
| 字段 | 类型 | 说明 |
|---|---|---|
| name / baseUrl / rssUrl | STRING | 来源信息 |
| trustLevel | FLOAT | 可信度 |
| language | STRING | 语言 |

#### NewsUserEvent 用户新闻行为表
| 字段 | 类型 | 说明 |
|---|---|---|
| userId | UUID | 用户 |
| newsId | UUID | 文章 |
| eventType | ENUM | impression / click / dwell / share |
| dwellMs | INT | 停留时间 |

#### NewsUserVector 用户新闻向量表
| 字段 | 类型 | 说明 |
|---|---|---|
| userId | UUID | 用户 |
| shortTermVector | JSONB | 短期兴趣向量 |
| longTermVector | JSONB | 长期兴趣向量 |

#### Experiment 实验表
| 字段 | 类型 | 说明 |
|---|---|---|
| id / name / status | STRING/ENUM | 实验基本信息 |
| bucketingType | ENUM | user / request / session |
| buckets | JSONB | 桶配置 (name, weight, config) |
| targetAudience | JSONB | 目标受众 |
| trafficPercent | FLOAT | 流量百分比 |
| startDate / endDate | DATE | 实验周期 |
| metrics / tags | ARRAY | 关联指标/标签 |

---

### 3.2 MongoDB (Mongoose) — 文档型数据

#### Message 消息文档
| 字段 | 类型 | 说明 |
|---|---|---|
| sender / receiver | String | 发送/接收者 ID |
| chatId | String | `p:userA:userB` (私聊) 或 `g:groupId` (群聊) |
| chatType | String | private / group |
| seq | Number | 会话内序列号 (原子自增) |
| groupId | String | 群 ID (群聊时) |
| type | Enum | text / image / file / video / audio / document / system |
| content | String | 消息内容 |
| status | Enum | sent / delivered / read |
| isGroupChat | Boolean | 是否群消息 |
| replyTo | ObjectId | 回复消息 ID |
| attachments | Array | 附件列表 (fileUrl, fileName, fileSize, mimeType, thumbnailUrl) |
| fileUrl / fileName / fileSize / mimeType / thumbnailUrl | String/Number | 旧版文件字段 |
| deletedAt / deletedBy | Date/String | 软删除 |

#### AiConversation AI 对话文档
| 字段 | 类型 | 说明 |
|---|---|---|
| userId | String | 用户 ID |
| conversationId | String | 对话 ID |
| title | String | 对话标题 |
| messages | Array | 消息数组 [{role, content, timestamp, type, imageData}] |

#### ChatCounter 聊天序列计数器
| 字段 | 类型 | 说明 |
|---|---|---|
| _id | String (chatId) | 聊天 ID |
| seq | Number | 当前最大序列号 |

#### ChatMemberState 成员阅读状态
| 字段 | 类型 | 说明 |
|---|---|---|
| chatId | String | 聊天 ID |
| userId | String | 用户 ID |
| lastReadSeq | Number | 最后已读消息序列号 |
| lastDeliveredSeq | Number | 最后已送达消息序列号 |
| lastSeenAt | Date | 最后查看时间 |
| mutedUntil | Date | 消息免打扰截止 |

#### Post 帖子/动态文档
| 字段 | 类型 | 说明 |
|---|---|---|
| authorId | String | 作者 ID |
| content | String | 正文 |
| media | Array | 媒体 [{type: image/video/gif, url}] |
| stats | Object | {likeCount, repostCount, quoteCount, commentCount, viewCount} |
| isRepost / originalPostId | Boolean/ObjectId | 转发标记 |
| isReply / replyToPostId / conversationId | Boolean/ObjectId | 回复标记 |
| keywords | Array | 关键词 (用于 MutedKeywordFilter) |
| language | String | 语言 |
| isNsfw / isPinned | Boolean | 标记 |
| engagementScore | Number | 互动分数 |
| phoenixScores | Object | Phoenix 模型预测分 (likeScore, replyScore, ...) |
| isNews / newsMetadata | Boolean/Object | 新闻帖标记 {title, source, url, externalId, clusterId, summary} |

#### Like / Comment / Repost 社交动作
- **Like**: userId + postId + authorId (唯一复合索引)
- **Comment**: userId, postId, content, parentId, replyToUserId, likeCount, 软删除
- **Repost**: userId, postId, type (repost/quote), quotePostId

#### SpaceProfile 空间资料
| 字段 | 类型 | 说明 |
|---|---|---|
| userId | String | 唯一 |
| displayName / bio / location / website / coverUrl | String | 个人资料 |

#### UserSettings 用户设置
| 字段 | 类型 | 说明 |
|---|---|---|
| userId | String | 唯一 |
| mutedKeywords / mutedUserIds | Array | 屏蔽关键词/用户 |
| notificationSettings / feedSettings / privacySettings | Object | 各类设置 |

#### UpdateLog 更新日志 (用于增量同步)
| 字段 | 类型 | 说明 |
|---|---|---|
| userId | String | 用户 ID |
| updateId | Number | 单调递增更新 ID |
| type | Enum | message / read / delivered / member_change / system |
| chatId | String | 关联聊天 |
| seq / messageId | Number/String | 消息序列/ID |
| payload | Mixed | 更多数据 |

#### UpdateCounter 更新计数器
| 字段 | 类型 | 说明 |
|---|---|---|
| _id | String (userId) | 用户 ID |
| updateId | Number | 当前更新 ID |

#### GroupState 群状态
| 字段 | 类型 | 说明 |
|---|---|---|
| _id | String (groupId) | 群 ID |
| lastSeq / lastMessageId | Number/String | 最后消息序列/ID |

#### SpaceUpload 空间上传 (回退存储)
| 字段 | 类型 | 说明 |
|---|---|---|
| filename / contentType / size | String/Number | 文件元数据 |
| data | Buffer | 文件二进制数据 |

#### UserMongo MongoDB 用户 (备用)
与 PostgreSQL User 表字段相同，作为 MongoDB 认证备用路径。

---

### 3.3 推荐系统专用模型 (MongoDB)

#### UserAction 用户行为
| 字段 | 类型 | 说明 |
|---|---|---|
| userId | String | 用户 |
| action | Enum | like/reply/repost/quote/click/impression/dwell/dismiss/not_interested/block/mute/follow/unfollow/share/bookmark/video_view/profile_click/detail_expand (18种) |
| targetPostId | ObjectId | 目标帖子 |
| targetAuthorId | String | 目标作者 |
| dwellTimeMs | Number | 停留时间 |
| rank | Number | 展示位次 |
| score | Number | 推荐分 |
| recallSource | String | 召回来源标记 |
| experimentKeys | Object | 实验分组信息 |

#### UserFeatureVector 用户特征向量
| 字段 | 类型 | 说明 |
|---|---|---|
| userId | String | 用户 (唯一) |
| interestedInClusters | Array | SimClusters 稀疏向量 [{clusterId, score}] |
| knownForCluster | Number | 代表聚类 |
| producerEmbedding | Array | 生产者嵌入 |
| twoTowerEmbedding | Array(64) | 双塔 ANN 嵌入 |
| phoenixEmbedding | Array(256) | Phoenix 模型嵌入 |
| twhinEmbedding | Array | TwHIN 嵌入 |
| qualityScore | Number | 用户质量分 |
| version | Number | 向量版本 |

#### UserSignal 用户信号 (复刻 X USS)
| 字段 | 类型 | 说明 |
|---|---|---|
| userId | String | 用户 |
| signalType | Enum | 30+ 种信号类型 (FAVORITE, RETWEET, REPLY, DWELL, FOLLOW, BLOCK, ...) |
| targetId | String | 目标 ID |
| targetType | Enum | post / user / topic |
| productSurface | Enum | home / search / notification / profile |
| metadata | Mixed | 额外数据 |

#### RealGraphEdge 社交关系边 (复刻 X Real Graph)
| 字段 | 类型 | 说明 |
|---|---|---|
| sourceUserId / targetUserId | String | 用户对 (唯一复合) |
| dailyCounts | Object | 每日交互计数 (like, reply, retweet, ...) |
| rollupCounts | Object | 累计聚合计数 |
| decayedSum | Number | 指数衰减聚合分 |
| interactionProbability | Number | ML 预测的交互概率 |
| lastInteractionAt | Date | 最后交互时间 |

#### ClusterDefinition 聚类定义 (复刻 X SimClusters)
| 字段 | 类型 | 说明 |
|---|---|---|
| clusterId | Number | 聚类 ID (唯一) |
| clusterType | String | user / content / topic |
| name | String | 聚类名 |
| topProducers | Array | [{userId, score}] |
| centroidEmbedding | Array(64) | 质心嵌入 |
| relatedClusters | Array | [{clusterId, similarity}] |
| stats | Object | {memberCount, postCount, avgEngagement} |
| parentClusterId / level | Number | 层级支持 |

---

### 3.4 Redis 数据结构

| 键模式 | 类型 | 用途 |
|---|---|---|
| `online_users` | Hash | userId → OnlineUser JSON |
| `user:{id}:last_seen` | String | 最后在线时间 (7天TTL) |
| `pts:user:{id}` | String | PTS 消息序列号 |
| `qts:user:{id}` | String | Secret Chat 序列号 |
| `refresh_token:{jti}` | String | Refresh Token JTI (7天TTL) |
| `conv:{chatId}:{page}` | String | 会话缓存 (10分钟TTL) |
| `sc:embed:{userId}` | String | SimClusters 嵌入缓存 (6h) |
| `rg:score:{pair}` | String | RealGraph 分数缓存 (24h) |
| `uss:signals:{userId}` | String | 用户信号缓存 (1h) |
| `fcs:*` | String | FeatureCacheService L2 缓存 |
| `tl:author:{authorId}` | SortedSet | In-network 时间线 (createdAt as score, 8天TTL) |
| `user_events_stream` | Stream | 用户行为事件流 (保留10万条) |
| BullMQ queues | Various | chat-message, notification, file-process, message-fanout |

---

## 4. 认证机制

### 4.1 JWT 双令牌体系
- **Access Token**: 默认 15 分钟有效期, 含 `userId`, `username`, `iss=telegram-clone`, `aud=telegram-users`
- **Refresh Token**: 默认 7 天有效期, 含唯一 `jti` (JWT ID)
- `JWT_SECRET` 要求 ≥ 16 字符
- Refresh Token 的 JTI 存储在 Redis 中，支持 **令牌轮换** (旧 JTI 删除 + 新 JTI 存储)

### 4.2 认证流程
1. **注册** `POST /api/auth/register`: bcrypt 哈希密码 → 创建用户 → 返回 token pair
2. **登录** `POST /api/auth/login`: 验证密码 → 生成 token pair (含 refreshJti) → 存 Redis
3. **刷新** `POST /api/auth/refresh`: 验证 refresh token → 校验 JTI 在 Redis → 轮换 → 新 token pair
4. **登出** `POST /api/auth/logout`: 从 Redis 删除 JTI

### 4.3 中间件
- `authMiddleware`: 从 `Authorization: Bearer <token>` 或 `?token=` 提取并验证
- `optionalAuth`: 尝试认证但不阻塞
- **CRON_SECRET bypass**: ML 服务回调使用 `x-cron-secret` header 绕过 JWT

### 4.4 Signal Protocol 密钥管理
- **X3DH 密钥协商**: 用户上传 identityKey + signedPreKey + 一次性预密钥
- **一次性预密钥消费**: `getPreKeyBundle` 自动消费一个 OneTimePreKey (用后删除)
- **低密钥告警**: 阈值 20 个，客户端可查询剩余数量并补充

### 4.5 双数据库 Auth 切换
- 运行时自动选择: 如果有 `USE_MONGODB_AUTH=true` 或缺少 PostgreSQL 配置则使用 MongoDB 认证路径

---

## 5. 全部 API 端点

### 5.1 认证 `/api/auth`
| 方法 | 路径 | 说明 | 中间件 |
|---|---|---|---|
| POST | /register | 注册 | - |
| POST | /login | 登录 | loginLimiter (10次/15分) |
| POST | /refresh | 刷新令牌 | - |
| GET | /me | 获取当前用户 | auth |
| POST | /logout | 登出 | auth |

### 5.2 消息 `/api/messages`
| 方法 | 路径 | 说明 | 中间件 |
|---|---|---|---|
| GET | /conversation/:receiverId | 获取私聊记录 (分页) | auth |
| GET | /chat/:chatId | 统一游标分页 (beforeSeq/afterSeq) | auth |
| GET | /group/:groupId | 获取群消息 | auth |
| POST | /send | 发送消息 (HTTP) | auth |
| PUT | /read | 标记已读 | auth |
| POST | /chat/:chatId/read | 按 chatId 标记已读 | auth |
| DELETE | /:messageId | 软删除消息 | auth |
| PUT | /:messageId | 编辑消息 | auth |
| GET | /unread-count | 获取未读数 | auth |
| GET | /search | 搜索消息 | auth |
| GET | /context | 获取消息上下文 | auth |

### 5.3 联系人 `/api/contacts`
| 方法 | 路径 | 说明 | 中间件 |
|---|---|---|---|
| POST | /add | 发送联系人请求 | auth |
| GET | / | 获取联系人列表 | auth |
| GET | /pending-requests | 获取待处理请求 | auth |
| PUT | /requests/:requestId | 处理请求 (accept/reject) | auth |
| DELETE | /:contactId | 删除联系人 | auth |
| POST | /:contactId/block | 拉黑联系人 | auth |
| PUT | /:contactId/alias | 修改备注名 | auth |
| GET | /search | 搜索用户 | auth |

### 5.4 群组 `/api/groups`
| 方法 | 路径 | 说明 | 中间件 |
|---|---|---|---|
| POST | / | 创建群组 | auth |
| GET | /my | 获取我的群组 (含未读数) | auth |
| GET | /search | 搜索群组 | auth |
| GET | /:groupId | 获取群详情 | auth |
| PUT | /:groupId | 更新群信息 | auth (admin+) |
| DELETE | /:groupId | 解散群 | auth (owner) |
| POST | /:groupId/members | 添加成员 | auth |
| DELETE | /:groupId/members/:memberId | 移除成员 | auth (admin+) |
| POST | /:groupId/members/:memberId/mute | 禁言成员 | auth (admin+) |
| POST | /:groupId/members/:memberId/unmute | 取消禁言 | auth (admin+) |
| POST | /:groupId/members/:memberId/promote | 提升为管理员 | auth (owner) |
| POST | /:groupId/members/:memberId/demote | 降级为成员 | auth (owner) |
| POST | /:groupId/leave | 退出群 | auth |
| POST | /:groupId/transfer-ownership | 转移群主 | auth (owner) |

### 5.5 AI 聊天 `/api/ai`
| 方法 | 路径 | 说明 | 中间件 |
|---|---|---|---|
| POST | /chat | AI 对话 | auth + aiLimiter (30次/分) |
| GET | /health | AI 健康检查 | auth |
| POST | /smart-replies | 智能回复建议 | auth + aiLimiter |
| GET | /info | AI 信息 | auth |

### 5.6 AI 对话管理 `/api/ai-chat`
| 方法 | 路径 | 说明 | 中间件 |
|---|---|---|---|
| GET | /messages | 获取对话消息 | auth |
| POST | /conversations | 创建新对话 | auth |
| GET | /conversations | 列出所有对话 | auth |
| GET | /conversations/:id | 获取对话详情 | auth |
| DELETE | /conversations/:id | 删除对话 | auth |
| PUT | /conversations/:id/title | 重命名对话 | auth |

### 5.7 密钥管理 `/api/keys`
| 方法 | 路径 | 说明 | 中间件 |
|---|---|---|---|
| PUT | / | 上传密钥包 | auth |
| GET | /:userId | 获取用户 PreKey Bundle | auth |
| GET | /count/me | 查询剩余预密钥数 | auth |
| POST | /prekeys | 补充预密钥 | auth |

### 5.8 文件上传 `/api/upload` & `/api/public/*`
| 方法 | 路径 | 说明 | 中间件 |
|---|---|---|---|
| POST | /upload | 上传文件 | auth + uploadLimiter (20次/5分) |
| GET | /uploads/:filename | 下载文件 | auth |
| GET | /uploads/thumbnails/:filename | 下载缩略图 | auth |
| GET | /public/space/uploads/:filename | 公开下载 Space 文件 | 无 |
| GET | /public/space/uploads/thumbnails/:filename | 公开下载 Space 缩略图 | 无 |
| GET | /public/news/uploads/:filename | 公开下载新闻图片 | 无 |

### 5.9 Space 社交动态 `/api/space`
| 方法 | 路径 | 说明 | 中间件 |
|---|---|---|---|
| POST | /posts | 发布帖子 (支持媒体) | auth |
| GET | /feed | 获取推荐 Feed | auth |
| GET | /posts/:id | 获取帖子详情 | auth |
| DELETE | /posts/:id | 删除帖子 | auth |
| POST | /posts/:id/like | 点赞 | auth |
| DELETE | /posts/:id/like | 取消点赞 | auth |
| POST | /posts/:id/repost | 转发/引用 | auth |
| POST | /posts/:id/comment | 评论 | auth |
| GET | /posts/:id/comments | 获取评论列表 | auth |
| GET | /profile/:userId | 获取用户资料 | auth |
| PUT | /profile | 更新资料 | auth |
| PUT | /profile/avatar | 更新头像 | auth |
| PUT | /profile/cover | 更新封面 | auth |
| GET | /contacts | 获取 Space 联系人 | auth |
| GET | /posts/:id/related | 获取相关帖子 | auth |

### 5.10 同步 `/api/sync`
| 方法 | 路径 | 说明 | 中间件 |
|---|---|---|---|
| GET | /state | 获取同步状态 | auth |
| POST | /difference | Gap Recovery (拉取缺失更新) | auth |
| POST | /ack | 确认收到更新 | auth |

### 5.11 新闻 `/api/news`
| 方法 | 路径 | 说明 | 中间件 |
|---|---|---|---|
| POST | /ingest | 批量导入新闻 | CRON_SECRET |
| GET | /feed | 获取新闻 Feed | auth |
| GET | /articles/:id | 获取文章详情 | auth |
| GET | /topics | 获取话题列表 | auth |
| POST | /events | 记录用户行为 | auth |

### 5.12 分析 `/api/analytics`
| 方法 | 路径 | 说明 | 中间件 |
|---|---|---|---|
| GET | /dashboard | 分析仪表盘 | auth |
| GET | /experiments/:id | 获取实验 | auth |
| PUT | /experiments/:id | 更新实验 | auth |
| POST | /experiments/:id/pause | 暂停实验 | auth |
| POST | /experiments/:id/resume | 恢复实验 | auth |
| POST | /events | 记录事件 | auth |
| POST | /events/batch | 批量记录 | auth |
| GET | /events/stats | 事件统计 | auth |
| GET | /events/export | 导出事件 | auth |

### 5.13 特征工程 `/api/features`
| 方法 | 路径 | 说明 | 中间件 |
|---|---|---|---|
| POST | /user/compute | 计算用户特征 | auth |
| POST | /batch/compute | 批量计算特征 | auth |
| POST | /simclusters/embed | SimClusters 嵌入 | auth |
| POST | /simclusters/similar | 查找相似用户 | auth |
| POST | /realgraph/score | RealGraph 交互分 | auth |
| POST | /realgraph/top | Top-N 亲密用户 | auth |
| POST | /signals/log | 记录用户信号 | auth |

### 5.14 ML 代理 `/api/ml`
| 方法 | 路径 | 说明 | 中间件 |
|---|---|---|---|
| POST | /ann/retrieve | ANN 近邻检索 (代理到 ML 服务) | auth |
| POST | /phoenix/predict | Phoenix 模型预测 (代理) | auth |
| POST | /vf/check | 内容安全检查 V1 (代理) | auth |
| POST | /vf/check/v2 | 内容安全检查 V2 (代理) | auth |

### 5.15 用户 `/api/users` (file exists, route mounting varies)
| 方法 | 路径 | 说明 | 中间件 |
|---|---|---|---|
| GET | /online | 获取在线用户 | auth |
| GET | /:userId/status | 获取用户状态 | auth |
| GET | /search | 搜索用户 | auth |

---

## 6. Socket.IO 实时事件

### 6.1 主聊天服务器 (端口同 HTTP)

**客户端 → 服务器事件:**
| 事件 | 数据 | 说明 |
|---|---|---|
| `authenticate` | `{ token }` | JWT 认证 |
| `sendMessage` | `{ content, chatType, receiverId?, groupId?, type?, attachments?, ... }` | 发送消息 (支持 ACK 回调) |
| `joinRoom` | `{ groupId }` | 加入群聊房间 |
| `leaveRoom` | `{ groupId }` | 离开群聊房间 |
| `updateStatus` | `{ status }` | 更新在线状态 |
| `typingStart` | `{ receiverId?, groupId? }` | 开始输入 |
| `typingStop` | `{ receiverId?, groupId? }` | 停止输入 |
| `presenceSubscribe` | `string[]` (userIds) | 订阅在线状态 |
| `readChat` | `{ chatId, seq }` | 标记已读 (按 seq) |

**服务器 → 客户端事件:**
| 事件 | 数据 | 说明 |
|---|---|---|
| `authenticated` | `{ userId, username, message }` | 认证成功 |
| `authError` | `{ message }` | 认证失败 |
| `message` | `{ type: 'chat'/'error'/'success', data? }` | 消息推送 |
| `userOnline` | `{ userId, username }` | 用户上线 |
| `userOffline` | `{ userId, username }` | 用户下线 |
| `onlineUsers` | `OnlineUser[]` | 在线用户列表 |
| `typingStart` | `{ userId, username, groupId? }` | 对方在输入 |
| `typingStop` | `{ userId, username, groupId? }` | 对方停止输入 |
| `presenceUpdate` | `{ userId, status, lastSeen? }` | 在线状态更新 |
| `readReceipt` | `{ chatId, seq, readCount, readerId }` | 已读回执 |
| `groupUpdate` | `payload` | 群组变更通知 |

**特殊功能:**
- `/ai` 前缀消息自动转发到 Gemini AI
- 认证时自动加入所有群聊房间
- 在线状态存储在 Redis `online_users` Hash

### 6.2 AI 独立 Socket 服务器 (端口 5850)
| 事件 | 方向 | 说明 |
|---|---|---|
| `authenticate` | C→S | JWT 认证 |
| `aiChat` | C→S | 发送 AI 消息 |
| `aiResponse` | S→C | AI 回复 |
| `error` | S→C | 错误信息 |

---

## 7. 中间件

| 中间件 | 文件 | 说明 |
|---|---|---|
| **authMiddleware** | authMiddleware.ts | JWT 令牌验证 (header/query), CRON_SECRET 旁路 |
| **optionalAuth** | authMiddleware.ts | 可选认证 (不阻塞) |
| **corsMiddleware** | cors.ts | CORS: localhost:*, Vercel 域名, 24h 预检缓存 |
| **errorHandler** | errorHandler.ts | 全局错误处理 (Mongoose/JWT/自定义错误), dev/prod 模式 |
| **requestLogger** | logger.ts | Morgan 日志, dev 模式含 body/query |
| **loginLimiter** | rateLimiter.ts | 登录限流: 10次/15分钟 |
| **aiLimiter** | rateLimiter.ts | AI 限流: 30次/分钟 |
| **uploadLimiter** | rateLimiter.ts | 上传限流: 20次/5分钟 |

---

## 8. Workers (异步处理)

### fanoutWorker (BullMQ)
- **队列**: `message-fanout`
- **功能**: 异步消息扇出分发
  - 批量更新所有群成员的 `ChatMemberState.lastDeliveredSeq`
  - 为每个接收者创建 `UpdateLog` 条目
- **触发条件**: 群成员数 > `GROUP_FANOUT_THRESHOLD` (默认 500)
- **配置**: 指数退避重试, 最大 3 次

### QueueService 队列
| 队列名 | 用途 |
|---|---|
| `chat-message` | 消息处理 |
| `notification` | 通知推送 |
| `file-process` | 文件处理 |
| `message-fanout` | 大群消息扇出 |

---

## 9. 服务层详解

### 9.1 消息服务 (messageService + messageWriteService)
- **createAndFanoutMessage**: 核心写路径
  1. 确定 chatType (private/group)
  2. 通过 `ChatCounter.findOneAndUpdate` 原子自增获取 seq
  3. 验证群成员资格
  4. 创建 Message 文档
  5. 小群 (≤500人): 同步扇出到所有成员
  6. 大群 (>500人): 通过 BullMQ 异步扇出
- **getConversation**: 带 Redis 缓存 (10分钟TTL) 的会话查询

### 9.2 Socket 服务 (socketService)
- 979 行, 最复杂的服务
- 管理 Socket.IO 连接生命周期
- 认证 → 加入房间 → 消息路由 → AI 转发 → 已读回执 → 断线清理
- Redis `online_users` Hash 管理在线状态
- 自动检测 `/ai` 前缀消息并转发到 Gemini

### 9.3 缓存服务 (cacheService)
- Redis 封装: get/set/delete/invalidatePattern
- 默认 TTL 600 秒
- 优雅降级: Redis 不可用时返回 null/false

### 9.4 联系人服务 (contactService)
- 请求/接受/拒绝/拉黑/搜索/获取列表
- 带缓存: 联系人列表缓存 + 失效

### 9.5 密钥服务 (keyService)
- Signal Protocol 密钥全生命周期
- 上传密钥包 (upsert UserKey + 批量添加 OneTimePreKey)
- 获取 PreKeyBundle (自动消费一次性密钥)
- 低密钥告警机制

### 9.6 更新服务 (updateService)
- 增量同步核心: UpdateLog + UpdateCounter
- `appendUpdate`: 原子递增 updateId + 写入日志
- `getUpdates`: 从 fromUpdateId 拉取缺失更新

### 9.7 序列服务 (sequenceService)
- 复刻 Telegram PTS (Post Timestamp Sequence) 机制
- Redis 原子 INCRBY 生成 PTS
- Gap 检测: apply / skip / gap
- 支持 QTS (Secret Chat 序列)

### 9.8 Pub/Sub 服务 (pubSubService)
- Redis Pub/Sub 用于 Socket.IO 集群间广播
- 6 个频道: new-message, message-read, typing, user-online/offline, notification
- 独立的 publisher/subscriber Redis 连接

### 9.9 事件流服务 (eventStreamService)
- Redis Stream 收集用户行为
- 支持 8 种事件: impression, click, like, reply, repost, share, scroll, dwell
- 内存缓冲 (100条) + 定时刷新 (5秒)
- Stream 保留最近 10 万条

### 9.10 Space 服务 (spaceService)
- 1531 行, 最大的服务文件
- 帖子 CRUD + 点赞/转发/评论
- 新闻帖子批量创建 (Crawler Hook)
- **推荐 Feed**: 通过 `SpaceFeedMixer` 管道获取
- In-network Timeline: 写入时存入 Redis ZSET

### 9.11 新闻服务 (newsService)
- 新闻批量导入 (URL 归一化 + SHA256 去重)
- 个性化/时间排序 Feed
- Markdown 正文 + 封面图存储 (S3 或本地)
- 用户行为记录 + 向量更新

### 9.12 新闻存储服务 (newsStorageService)
- 双存储后端: S3 + 本地文件系统
- 正文存储: Markdown 文件 (SHA256 hash 命名)
- 图片下载+存储: 自动从 URL 下载到 S3/本地

---

## 10. 推荐系统 (X/Twitter Algorithm 复刻)

### 10.1 架构概览
```
                    SpaceFeedMixer (编排层)
                          │
    ┌─────────────────────┼─────────────────────┐
    │                     │                     │
QueryHydrators       Sources              Pipeline
    │                     │                     │
    ├─ UserFeatures      ├─ FollowingSource    ├─ Filters
    ├─ UserActionSeq     ├─ PopularSource      ├─ Scorers
    ├─ NewsModelCtx      ├─ TwoTowerSource     ├─ Selector
    └─ ExperimentCtx     ├─ NewsAnnSource      └─ SideEffects
                         └─ ColdStartSource
```

### 10.2 推荐管道框架 (framework/)
- **RecommendationPipeline**: 通用管道执行器 (695 行)
  - Builder 模式 API
  - 7 阶段顺序执行: QueryHydration → Sourcing → Hydrating → Filtering → Scoring → Selecting → SideEffects
  - 并行执行 Sources 和 Hydrators
  - 组件级超时 (1.5s)
  - 详细耗时统计
- **核心接口**: Source, QueryHydrator, Hydrator, Filter, Scorer, Selector, SideEffect

### 10.3 候选召回源 (sources/)
| Source | 说明 |
|---|---|
| **FollowingSource** | 关注网络内帖子 (复刻 Thunder), 使用 InNetworkTimelineService Redis ZSET |
| **PopularSource** | 热门帖子 (Phoenix 启发式排序) |
| **TwoTowerSource** | 双塔 ANN 近邻召回 (社交 OON) |
| **NewsAnnSource** | 新闻 ANN 召回 + externalId 映射到本地 Post |
| **ColdStartSource** | 冷启动内容 (新用户专用) |
| **GraphSource** | 图关系召回 |

### 10.4 查询丰富器 (hydrators/)
| Hydrator | 说明 |
|---|---|
| **UserFeaturesQueryHydrator** | 加载用户特征 (关注/屏蔽/静音/已看) |
| **UserActionSeqQueryHydrator** | 加载用户行为序列 (最近动作) |
| **NewsModelContextQueryHydrator** | 加载新闻 externalId 上下文 (ANN/Phoenix 用) |
| **ExperimentQueryHydrator** | 填充 A/B 实验上下文 |
| **AuthorInfoHydrator** | 丰富候选者的作者信息 |
| **UserInteractionHydrator** | 丰富用户交互状态 (是否已赞/转发) |
| **VideoInfoHydrator** | 丰富视频/安全信息 |
| **VFCandidateHydrator** | Visibility Filtering 候选丰富 |

### 10.5 过滤器 (filters/)
| Filter | 说明 |
|---|---|
| **DuplicateFilter** | 跨源去重 (postId) |
| **NewsExternalIdDedupFilter** | 新闻 externalId/cluster 级别去重 |
| **SelfPostFilter** | 过滤自己的帖子 |
| **RetweetDedupFilter** | 转推/引用去重 |
| **AgeFilter** | 时间窗过滤 (默认 7 天) |
| **BlockedUserFilter** | 屏蔽用户过滤 |
| **MutedKeywordFilter** | 静音关键词过滤 |
| **SeenPostFilter** | 已读帖子过滤 |
| **PreviouslyServedFilter** | 已送达帖子过滤 |
| **ConversationDedupFilter** | 对话线程去重 |
| **VFFilter** | Visibility Filtering (内容安全) |
| **SafetyFilter** | 安全过滤器 |

### 10.6 评分器 (scorers/)
| Scorer | 说明 |
|---|---|
| **EngagementScorer** | 互动分数 (赞/评/转加权) |
| **RecencyScorer** | 时效性分数 (指数衰减) |
| **AuthorAffinityScorer** | 作者亲密度 (基于 RealGraph) |
| **ContentQualityScorer** | 内容质量分 |
| **OONScorer** | Out-of-Network 分数调整 |
| **AuthorDiversityScorer** | 作者多样性 (避免同作者刷屏) |
| **PhoenixScorer** | Phoenix ML 模型评分 (18种行为预测) |
| **WeightedScorer** | 加权混合总分 |

### 10.7 选择器与副作用
- **TopKSelector**: Top-K 选择最终结果
- **ImpressionLogger**: 记录曝光日志 (写入 UserAction)
- **MetricsCollector**: 收集管道执行指标
- **ServeCacheSideEffect**: 已送达缓存更新

### 10.8 核心推荐服务

#### SimClustersService (415 行)
- 复刻 X SimClusters v2
- 计算 InterestedIn 嵌入 (基于关注列表 + RealGraph 权重)
- 计算 ProducerEmbedding (基于粉丝列表)
- 用户相似度计算 (稀疏向量点积)
- 6 小时 Redis 缓存

#### RealGraphService (459 行)
- 复刻 X Interaction Graph
- 记录 6 种交互类型: like, reply, retweet, quote, follow/unfollow, profile_view, tweet_click, dwell, block, mute
- 每日衰减聚合 (指数衰减, 半衰期 7 天)
- ML 交互概率预测 (简化线性模型, Sigmoid 映射)
- 日衰减批处理 (cron 04:00)

#### UserSignalService (447 行)
- 复刻 X User Signal Service (USS)
- 30+ 种信号类型
- 高吞吐写入: 内存缓冲 (1000条) + 5 秒刷新
- 信号自动同步到 RealGraph

#### FeatureCacheService (537 行)
- 三层缓存: L1 内存 (60s, 5000条) → L2 Redis (6h/24h/7d) → L3 MongoDB
- 支持批量操作
- 缓存穿透/雪崩/击穿防护

#### InNetworkTimelineService (161 行)
- Redis ZSET 时间线
- 写入轻量: 发帖时一次 ZADD
- 读取合并: 遍历关注列表, ZRANGEBYSCORE 获取
- 7 天窗口 + 每作者 200 上限
- 动态 per-author fetch 预算

### 10.9 ML 服务客户端 (clients/)
| Client | 说明 |
|---|---|
| **ANNClient** | ANN 近邻检索客户端 |
| **PhoenixClient** | Phoenix 模型预测客户端 |
| **VFClient** | Visibility Filtering 客户端 |
| **GraphClient** | 图服务客户端 |
| **FeedRecommendClient** | Feed 推荐聚合客户端 (HTTP) |

---

## 11. A/B 实验框架

### 11.1 组件
- **ExperimentService**: 核心引擎, SHA256 哈希分流, 支持 user/request/session 级别
- **PostgresExperimentStore**: 持久存储
- **InMemoryExperimentStore**: 开发/测试用
- **ExperimentLogger**: 日志记录
- **ExperimentQueryHydrator**: 管道集成

### 11.2 功能
- 哈希确定性分流 (同用户同实验始终同组)
- 目标受众过滤 (粉丝数、账龄、平台、地区、白/黑名单)
- 流量百分比控制
- 实验生命周期: draft → running → paused → completed
- API: CRUD + pause/resume

---

## 12. AI 集成

### 12.1 Gemini AI 对话
- **模型**: `gemini-2.0-flash`
- **API**: Google Generative Language API
- **多模态**: 支持文本 + 图片输入
- **对话历史**: 最多 10 条上下文消息
- **访问方式**:
  1. HTTP API: `POST /api/ai/chat`
  2. Socket.IO 主服务: 消息以 `/ai ` 前缀触发
  3. 独立 AI Socket 服务器: 端口 5850

### 12.2 智能回复
- `POST /api/ai/smart-replies`: 基于消息上下文生成 3 个建议回复

### 12.3 AI 对话持久化
- MongoDB `AiConversation` 模型
- 支持多对话管理 (创建/列表/删除/重命名)

---

## 13. 定时任务 (Cron Jobs)

| 时间 | 任务 | 说明 |
|---|---|---|
| 00:00 | 新闻清理 | 删除过期新闻文章 |
| 00:30 | 新闻内容清理 | 清理新闻正文/图片存储 |
| 01:00 | 用户向量更新 | 更新 NewsUserVector |
| 03:00 | SimClusters 批处理 | 全量更新用户嵌入 |
| 04:00 | RealGraph 衰减 | 执行每日交互分数衰减 |

---

## 14. 部署配置

### 14.1 render.yaml (Render.com)
```yaml
services:
  - name: telegram-clone-backend
    type: web
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - MONGODB_URI
      - DATABASE_URL (PostgreSQL)
      - REDIS_URL
      - JWT_SECRET
      - GEMINI_API_KEY
      - SENTRY_DSN
      - AWS S3 配置 (6 个变量)
      - ML_SERVICE_URL
      - CRON_SECRET
```

### 14.2 tsconfig.json
- Target: ES2020
- Module: commonjs
- Strict mode: true
- outDir: ./dist
- rootDir: ./src
- Source maps: enabled

### 14.3 环境变量
| 变量 | 说明 |
|---|---|
| `MONGODB_URI` | MongoDB 连接串 |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `REDIS_URL` / `REDIS_HOST` + `REDIS_PORT` | Redis |
| `JWT_SECRET` | JWT 密钥 (≥16字符) |
| `JWT_ACCESS_EXPIRY` / `JWT_REFRESH_EXPIRY` | 令牌有效期 |
| `GEMINI_API_KEY` | Google Gemini API Key |
| `SENTRY_DSN` | Sentry 错误追踪 |
| `PORT` | 服务端口 (默认 3001) |
| `AI_SOCKET_PORT` | AI Socket 端口 (默认 5850) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `AWS_S3_BUCKET` | S3 存储 |
| `ML_SERVICE_URL` | ML 微服务地址 |
| `CRON_SECRET` | 定时任务/ML 回调密钥 |
| `GROUP_FANOUT_THRESHOLD` | 大群扇出阈值 (默认 500) |
| `NEWS_TIMEZONE` | 新闻时区 (默认 Asia/Shanghai) |
| `NEWS_S3_*` | 新闻存储 S3 配置 (7 个变量) |
| `USE_MONGODB_AUTH` | 启用 MongoDB 认证 |

---

## 15. 项目目录结构
```
telegram-clone-backend/
├── package.json
├── tsconfig.json
├── render.yaml
├── src/
│   ├── index.ts                  # 主入口 (433行)
│   ├── aiSocketServer.ts         # AI Socket 服务器
│   ├── config/
│   │   ├── db.ts                 # MongoDB 连接
│   │   ├── redis.ts              # Redis 连接
│   │   └── sequelize.ts          # PostgreSQL 连接
│   ├── controllers/              # 控制器 (8个)
│   │   ├── aiController.ts       # AI 对话
│   │   ├── authController.ts     # PostgreSQL 认证
│   │   ├── authControllerMongo.ts # MongoDB 认证
│   │   ├── contactController.ts  # 联系人
│   │   ├── groupController.ts    # 群组 (1167行)
│   │   ├── messageController.ts  # 消息 (864行)
│   │   ├── uploadController.ts   # 文件上传 (764行)
│   │   └── userController.ts     # 用户
│   ├── middleware/               # 中间件 (5个)
│   ├── models/                   # 数据模型 (31个)
│   ├── routes/                   # 路由 (15个)
│   ├── services/                 # 服务层
│   │   ├── socketService.ts      # Socket.IO (979行)
│   │   ├── socketRegistry.ts     # Socket 单例
│   │   ├── messageService.ts     # 消息业务
│   │   ├── messageWriteService.ts # 消息写入
│   │   ├── queueService.ts       # BullMQ 队列
│   │   ├── cacheService.ts       # Redis 缓存
│   │   ├── contactService.ts     # 联系人业务
│   │   ├── keyService.ts         # Signal 密钥
│   │   ├── updateService.ts      # 增量同步
│   │   ├── sequenceService.ts    # PTS 序列
│   │   ├── pubSubService.ts      # Redis Pub/Sub
│   │   ├── eventStreamService.ts # 行为事件流
│   │   ├── spaceService.ts       # 社交动态 (1531行)
│   │   ├── newsService.ts        # 新闻
│   │   ├── newsStorageService.ts # 新闻存储
│   │   ├── recommendation/       # 推荐系统
│   │   │   ├── SpaceFeedMixer.ts # 管道编排 (243行)
│   │   │   ├── SimClustersService.ts # SimClusters (415行)
│   │   │   ├── RealGraphService.ts   # RealGraph (459行)
│   │   │   ├── UserSignalService.ts  # USS (447行)
│   │   │   ├── FeatureCacheService.ts # 特征缓存 (537行)
│   │   │   ├── InNetworkTimelineService.ts # 时间线 (161行)
│   │   │   ├── framework/        # 管道框架 (Pipeline, interfaces)
│   │   │   ├── sources/          # 6个召回源
│   │   │   ├── filters/          # 12个过滤器
│   │   │   ├── scorers/          # 8个评分器
│   │   │   ├── hydrators/        # 8个丰富器
│   │   │   ├── selectors/        # TopK 选择器
│   │   │   ├── sideeffects/      # 3个副作用
│   │   │   ├── clients/          # 5个 ML 客户端
│   │   │   ├── featureStore/     # 特征存储
│   │   │   ├── types/            # FeedQuery, FeedCandidate
│   │   │   └── utils/            # 工具函数
│   │   └── experiment/           # A/B 实验框架
│   │       ├── ExperimentService.ts  # 实验引擎
│   │       ├── ExperimentLogger.ts   # 日志
│   │       ├── PostgresExperimentStore.ts # PG 存储
│   │       └── types.ts          # 类型定义
│   ├── utils/                    # 工具 (5个)
│   │   ├── AppError.ts           # 自定义错误
│   │   ├── apiResponse.ts        # 统一响应格式
│   │   ├── chat.ts               # chatId 工具
│   │   ├── jwt.ts                # JWT 工具
│   │   └── refreshTokenStore.ts  # Refresh Token Redis 存储
│   └── workers/
│       └── fanoutWorker.ts       # 消息扇出 Worker
├── docs/                         # 文档
├── scripts/                      # 迁移/种子脚本
├── tests/                        # 测试
└── uploads/                      # 文件上传目录
```

---

## 16. 关键设计模式总结

| 模式 | 应用场景 |
|---|---|
| **三数据库架构** | PostgreSQL (关系) + MongoDB (文档/消息) + Redis (缓存/队列/状态) |
| **JWT 双令牌 + JTI 轮换** | 安全认证, refresh token 单次使用 |
| **PTS 消息序列** | 复刻 Telegram 的消息顺序保证 + Gap Recovery |
| **UpdateLog 增量同步** | 客户端断线重连后拉取缺失更新 |
| **BullMQ 异步扇出** | 大群消息分发性能优化 |
| **Builder 模式管道** | 推荐系统 7 阶段管道可组装 |
| **三层特征缓存** | L1 内存 → L2 Redis → L3 MongoDB |
| **Write-light 时间线** | Redis ZSET, 写入时只写作者 ZSET, 读取时合并 |
| **Signal Protocol 密钥管理** | X3DH 端到端加密密钥协商 |
| **Pub/Sub 集群广播** | Redis Pub/Sub 支持多实例部署 |
| **哈希确定性实验分流** | SHA256(experimentId + userId) 确保一致性 |
| **优雅降级** | Redis/AI 不可用时不影响核心功能 |
