/**
 * GraphClient - 图数据库客户端
 * 支持 Neo4j 和 内存模拟模式
 * 用于 Graph-based 召回
 */

import axios, { AxiosInstance } from 'axios';

// ========== 类型定义 ==========

/**
 * 图召回结果
 */
export interface GraphCandidate {
    /** 帖子 ID */
    postId: string;
    /** 召回分数 */
    score: number;
    /** 召回路径 (如 "via_user:123", "topic:tech") */
    path: string;
    /** 召回类型 */
    type: GraphRecallType;
    /** 相关用户 ID (二度关注召回) */
    viaUserId?: string;
    /** 相关话题 (话题召回) */
    topic?: string;
}

/**
 * 图召回类型
 */
export type GraphRecallType = 
    | 'friend_of_friend'  // 二度关注 (朋友的朋友)
    | 'similar_user'      // 相似用户 (共同关注)
    | 'topic_interest'    // 话题兴趣
    | 'engagement_chain'  // 互动链 (点赞/回复过的帖子的作者)
    | 'community';        // 社区发现

/**
 * 图召回请求
 */
export interface GraphRecallRequest {
    userId: string;
    /** 召回类型 (不指定则全部) */
    types?: GraphRecallType[];
    /** 每种类型的最大召回数 */
    limitPerType?: number;
    /** 总最大召回数 */
    maxTotal?: number;
    /** 排除的帖子 ID */
    excludePostIds?: string[];
    /** 排除的作者 ID */
    excludeAuthorIds?: string[];
}

/**
 * 图数据库客户端接口
 */
export interface GraphClient {
    /** 获取候选 */
    recall(request: GraphRecallRequest): Promise<GraphCandidate[]>;
    /** 健康检查 */
    healthCheck?(): Promise<boolean>;
}

// ========== Neo4j HTTP 客户端 ==========

export interface Neo4jConfig {
    /** Neo4j HTTP 端点 */
    endpoint: string;
    /** 用户名 */
    username?: string;
    /** 密码 */
    password?: string;
    /** 数据库名 */
    database?: string;
    /** 超时 (ms) */
    timeoutMs?: number;
}

export class Neo4jHttpClient implements GraphClient {
    private client: AxiosInstance;
    private config: Required<Omit<Neo4jConfig, 'username' | 'password'>> & Partial<Pick<Neo4jConfig, 'username' | 'password'>>;

    constructor(config: Neo4jConfig) {
        this.config = {
            endpoint: config.endpoint,
            database: config.database ?? 'neo4j',
            timeoutMs: config.timeoutMs ?? 3000,
            username: config.username,
            password: config.password,
        };

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (this.config.username && this.config.password) {
            const auth = Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64');
            headers['Authorization'] = `Basic ${auth}`;
        }

        this.client = axios.create({
            baseURL: this.config.endpoint,
            timeout: this.config.timeoutMs,
            headers,
        });
    }

    /**
     * 执行 Cypher 查询
     */
    async executeCypher<T = any>(query: string, params: Record<string, any> = {}): Promise<T[]> {
        try {
            const response = await this.client.post('/db/neo4j/tx/commit', {
                statements: [{
                    statement: query,
                    parameters: params,
                }],
            });

            const results = response.data?.results?.[0]?.data ?? [];
            return results.map((r: any) => r.row);
        } catch (error: any) {
            console.error('[Neo4jClient] Cypher execution failed:', error.message);
            return [];
        }
    }

    /**
     * 图召回
     */
    async recall(request: GraphRecallRequest): Promise<GraphCandidate[]> {
        const types = request.types ?? [
            'friend_of_friend',
            'similar_user',
            'topic_interest',
        ];
        const limitPerType = request.limitPerType ?? 30;
        const candidates: GraphCandidate[] = [];

        for (const type of types) {
            let typeCandidates: GraphCandidate[] = [];

            switch (type) {
                case 'friend_of_friend':
                    typeCandidates = await this.friendOfFriendRecall(
                        request.userId,
                        limitPerType,
                        request.excludeAuthorIds
                    );
                    break;
                case 'similar_user':
                    typeCandidates = await this.similarUserRecall(
                        request.userId,
                        limitPerType,
                        request.excludeAuthorIds
                    );
                    break;
                case 'topic_interest':
                    typeCandidates = await this.topicInterestRecall(
                        request.userId,
                        limitPerType
                    );
                    break;
                case 'engagement_chain':
                    typeCandidates = await this.engagementChainRecall(
                        request.userId,
                        limitPerType
                    );
                    break;
            }

            candidates.push(...typeCandidates);
        }

        // 排除已有帖子
        let filtered = candidates;
        if (request.excludePostIds?.length) {
            const excludeSet = new Set(request.excludePostIds);
            filtered = candidates.filter(c => !excludeSet.has(c.postId));
        }

        // 限制总数
        if (request.maxTotal && filtered.length > request.maxTotal) {
            filtered = filtered.slice(0, request.maxTotal);
        }

        return filtered;
    }

    /**
     * 二度关注召回
     * 获取关注的人的关注的人发的帖子
     */
    private async friendOfFriendRecall(
        userId: string,
        limit: number,
        excludeAuthors?: string[]
    ): Promise<GraphCandidate[]> {
        const query = `
            MATCH (me:User {id: $userId})-[:FOLLOWS]->(friend:User)-[:FOLLOWS]->(fof:User)-[:POSTED]->(post:Post)
            WHERE me <> fof
              AND NOT (me)-[:FOLLOWS]->(fof)
              AND post.createdAt > datetime() - duration('P7D')
              ${excludeAuthors?.length ? 'AND NOT fof.id IN $excludeAuthors' : ''}
            WITH post, fof, friend, COUNT(DISTINCT friend) AS sharedConnections
            ORDER BY sharedConnections DESC, post.engagementScore DESC
            LIMIT $limit
            RETURN post.id AS postId, 
                   toFloat(sharedConnections) / 10.0 AS score,
                   friend.id AS viaUserId
        `;

        const results = await this.executeCypher<[string, number, string]>(query, {
            userId,
            limit,
            excludeAuthors: excludeAuthors ?? [],
        });

        return results.map(([postId, score, viaUserId]) => ({
            postId,
            score: Math.min(score, 1.0),
            path: `via_user:${viaUserId}`,
            type: 'friend_of_friend' as GraphRecallType,
            viaUserId,
        }));
    }

    /**
     * 相似用户召回
     * 基于共同关注找到相似用户的帖子
     */
    private async similarUserRecall(
        userId: string,
        limit: number,
        excludeAuthors?: string[]
    ): Promise<GraphCandidate[]> {
        const query = `
            MATCH (me:User {id: $userId})-[:FOLLOWS]->(common:User)<-[:FOLLOWS]-(similar:User)
            WHERE me <> similar
              ${excludeAuthors?.length ? 'AND NOT similar.id IN $excludeAuthors' : ''}
            WITH similar, COUNT(common) AS sharedFollows
            ORDER BY sharedFollows DESC
            LIMIT 20
            MATCH (similar)-[:POSTED]->(post:Post)
            WHERE post.createdAt > datetime() - duration('P7D')
            WITH post, similar, sharedFollows
            ORDER BY sharedFollows DESC, post.engagementScore DESC
            LIMIT $limit
            RETURN post.id AS postId,
                   toFloat(sharedFollows) / 20.0 AS score,
                   similar.id AS viaUserId
        `;

        const results = await this.executeCypher<[string, number, string]>(query, {
            userId,
            limit,
            excludeAuthors: excludeAuthors ?? [],
        });

        return results.map(([postId, score, viaUserId]) => ({
            postId,
            score: Math.min(score, 1.0),
            path: `similar_user:${viaUserId}`,
            type: 'similar_user' as GraphRecallType,
            viaUserId,
        }));
    }

    /**
     * 话题兴趣召回
     * 基于用户感兴趣的话题
     */
    private async topicInterestRecall(
        userId: string,
        limit: number
    ): Promise<GraphCandidate[]> {
        const query = `
            MATCH (me:User {id: $userId})-[r:INTERESTED_IN]->(topic:Topic)<-[:HAS_TOPIC]-(post:Post)
            WHERE post.createdAt > datetime() - duration('P7D')
            WITH post, topic, r.weight AS interestWeight
            ORDER BY interestWeight DESC, post.engagementScore DESC
            LIMIT $limit
            RETURN post.id AS postId,
                   interestWeight AS score,
                   topic.name AS topicName
        `;

        const results = await this.executeCypher<[string, number, string]>(query, {
            userId,
            limit,
        });

        return results.map(([postId, score, topicName]) => ({
            postId,
            score: Math.min(score, 1.0),
            path: `topic:${topicName}`,
            type: 'topic_interest' as GraphRecallType,
            topic: topicName,
        }));
    }

    /**
     * 互动链召回
     * 基于用户互动过的帖子的作者
     */
    private async engagementChainRecall(
        userId: string,
        limit: number
    ): Promise<GraphCandidate[]> {
        const query = `
            MATCH (me:User {id: $userId})-[action:LIKED|REPLIED|REPOSTED]->(interactedPost:Post)<-[:POSTED]-(author:User)
            WHERE NOT (me)-[:FOLLOWS]->(author)
              AND me <> author
            WITH author, COUNT(action) AS interactions
            ORDER BY interactions DESC
            LIMIT 10
            MATCH (author)-[:POSTED]->(post:Post)
            WHERE post.createdAt > datetime() - duration('P7D')
            WITH post, author, interactions
            ORDER BY interactions DESC, post.engagementScore DESC
            LIMIT $limit
            RETURN post.id AS postId,
                   toFloat(interactions) / 10.0 AS score,
                   author.id AS viaUserId
        `;

        const results = await this.executeCypher<[string, number, string]>(query, {
            userId,
            limit,
        });

        return results.map(([postId, score, viaUserId]) => ({
            postId,
            score: Math.min(score, 1.0),
            path: `engagement:${viaUserId}`,
            type: 'engagement_chain' as GraphRecallType,
            viaUserId,
        }));
    }

    async healthCheck(): Promise<boolean> {
        try {
            await this.executeCypher('RETURN 1');
            return true;
        } catch {
            return false;
        }
    }
}

// ========== 内存模拟客户端 (开发/测试用) ==========

export class InMemoryGraphClient implements GraphClient {
    private follows: Map<string, Set<string>> = new Map();
    private posts: Map<string, { authorId: string; createdAt: Date }> = new Map();
    private interests: Map<string, Map<string, number>> = new Map(); // userId -> topic -> weight

    /**
     * 模拟数据: 添加关注关系
     */
    addFollow(followerId: string, followeeId: string): void {
        if (!this.follows.has(followerId)) {
            this.follows.set(followerId, new Set());
        }
        this.follows.get(followerId)!.add(followeeId);
    }

    /**
     * 模拟数据: 添加帖子
     */
    addPost(postId: string, authorId: string, createdAt: Date = new Date()): void {
        this.posts.set(postId, { authorId, createdAt });
    }

    /**
     * 模拟数据: 添加兴趣
     */
    addInterest(userId: string, topic: string, weight: number): void {
        if (!this.interests.has(userId)) {
            this.interests.set(userId, new Map());
        }
        this.interests.get(userId)!.set(topic, weight);
    }

    async recall(request: GraphRecallRequest): Promise<GraphCandidate[]> {
        const candidates: GraphCandidate[] = [];
        const limit = request.limitPerType ?? 20;

        // 简单实现二度关注
        const myFollows = this.follows.get(request.userId) ?? new Set();
        const fofAuthors = new Set<string>();

        for (const friend of myFollows) {
            const friendFollows = this.follows.get(friend) ?? new Set();
            for (const fof of friendFollows) {
                if (fof !== request.userId && !myFollows.has(fof)) {
                    fofAuthors.add(fof);
                }
            }
        }

        // 获取 fof 的帖子
        for (const [postId, { authorId }] of this.posts) {
            if (fofAuthors.has(authorId)) {
                candidates.push({
                    postId,
                    score: 0.5,
                    path: `via_user:${authorId}`,
                    type: 'friend_of_friend',
                    viaUserId: authorId,
                });
            }
        }

        return candidates.slice(0, request.maxTotal ?? 100);
    }

    async healthCheck(): Promise<boolean> {
        return true;
    }
}

// ========== 工厂函数 ==========

let graphClientInstance: GraphClient | null = null;

export function getGraphClient(): GraphClient {
    if (!graphClientInstance) {
        const neo4jEndpoint = process.env.NEO4J_ENDPOINT;
        
        if (neo4jEndpoint) {
            graphClientInstance = new Neo4jHttpClient({
                endpoint: neo4jEndpoint,
                username: process.env.NEO4J_USERNAME,
                password: process.env.NEO4J_PASSWORD,
                database: process.env.NEO4J_DATABASE ?? 'neo4j',
            });
            console.log('[GraphClient] Using Neo4j:', neo4jEndpoint);
        } else {
            graphClientInstance = new InMemoryGraphClient();
            console.log('[GraphClient] Using InMemory (development mode)');
        }
    }
    return graphClientInstance;
}

export function initGraphClient(client: GraphClient): void {
    graphClientInstance = client;
}
