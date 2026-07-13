/**
 * FeatureExportJob - 特征导出作业
 * 
 * 将特征数据导出到 FAISS 向量索引
 * 用于高效的相似度搜索
 * 
 * 运行频率: 每小时
 * 
 * 功能:
 * - 导出用户嵌入到 FAISS
 * - 导出聚类质心到 FAISS
 * - 增量更新索引
 */

import UserFeatureVector from '../../models/UserFeatureVector';
import ClusterDefinition from '../../models/ClusterDefinition';
import PostFeatureSnapshot from '../../models/PostFeatureSnapshot';
import {
    DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
    isVectorCompatibleWithContract,
} from '../recommendation/contracts/embeddingContract';
import { classifyEmbeddingContractEvidence } from '../recommendation/contracts/embeddingContractEvidence';
import * as fs from 'fs';
import * as path from 'path';

// ========== 配置 ==========
const CONFIG = {
    // 导出路径
    exportDir: process.env.FAISS_EXPORT_DIR || '/tmp/faiss_export',

    // 批量处理
    batchSize: 1000,
    maxExportSize: 100000,

    // 嵌入维度
    userEmbeddingDim: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.retrievalEmbeddingDim,
    clusterEmbeddingDim: 64,

    // 文件名
    files: {
        userEmbeddings: 'user_embeddings.json',
        clusterCentroids: 'cluster_centroids.json',
        postEmbeddings: 'post_embeddings.json',
        metadata: 'export_metadata.json',
    },
};

// ========== 导出格式 ==========
interface ExportedEmbedding {
    id: string;
    vector: number[];
    metadata?: Record<string, unknown>;
}

interface ExportMetadata {
    exportedAt: string;
    version: number;
    userCount: number;
    clusterCount: number;
    postCount: number;
    userEmbeddingDim: number;
    clusterEmbeddingDim: number;
    postEmbeddingDim: number;
}

type ExportArtifactMetadata = Omit<ExportMetadata, 'exportedAt' | 'version'>;

// ========== 作业类 ==========
export class FeatureExportJob {
    private isRunning = false;

    /**
     * 运行导出作业
     */
    async run(options?: {
        onlyUsers?: boolean;
        onlyClusters?: boolean;
        onlyPosts?: boolean;
        outputDir?: string;
    }): Promise<{
        usersExported: number;
        clustersExported: number;
        postsExported: number;
        durationMs: number;
    }> {
        if (this.isRunning) {
            throw new Error('[FeatureExportJob] Job is already running');
        }

        this.isRunning = true;
        const startTime = Date.now();
        let usersExported = 0;
        let clustersExported = 0;
        let postsExported = 0;
        let publishedUserCount: number | undefined;

        const outputDir = options?.outputDir || CONFIG.exportDir;
        const exportUsers = !options?.onlyClusters && !options?.onlyPosts;
        const exportClusters = !options?.onlyUsers && !options?.onlyPosts;
        const exportPosts = !options?.onlyUsers && !options?.onlyClusters;
        const partialRun = !(exportUsers && exportClusters && exportPosts);

        try {
            console.log('[FeatureExportJob] Starting export job...');

            const existingUserArtifact = await this.fileExists(
                path.join(outputDir, CONFIG.files.userEmbeddings),
            );
            const previousMetadata = partialRun || (exportUsers && existingUserArtifact)
                ? await this.readExistingMetadata(outputDir)
                : undefined;
            await this.ensureDir(outputDir);

            // 导出用户嵌入
            if (exportUsers) {
                publishedUserCount = await this.exportUserEmbeddings(outputDir);
                usersExported = publishedUserCount ?? 0;
                console.log(`[FeatureExportJob] Exported ${usersExported} user embeddings`);
            }

            // 导出聚类质心
            if (exportClusters) {
                clustersExported = await this.exportClusterCentroids(outputDir);
                console.log(`[FeatureExportJob] Exported ${clustersExported} cluster centroids`);
            }

            if (exportPosts) {
                postsExported = await this.exportPostEmbeddings(outputDir);
                console.log(`[FeatureExportJob] Exported ${postsExported} post embeddings`);
            }

            const artifactPublished = publishedUserCount !== undefined || exportClusters || exportPosts;
            if (artifactPublished) {
                await this.writeMetadata(outputDir, {
                    userCount: exportUsers
                        ? publishedUserCount ?? previousMetadata?.userCount ?? 0
                        : previousMetadata!.userCount,
                    clusterCount: exportClusters
                        ? clustersExported
                        : previousMetadata!.clusterCount,
                    postCount: exportPosts
                        ? postsExported
                        : previousMetadata!.postCount,
                    userEmbeddingDim: exportUsers && publishedUserCount !== undefined
                        ? CONFIG.userEmbeddingDim
                        : previousMetadata?.userEmbeddingDim ?? CONFIG.userEmbeddingDim,
                    clusterEmbeddingDim: exportClusters
                        ? CONFIG.clusterEmbeddingDim
                        : previousMetadata!.clusterEmbeddingDim,
                    postEmbeddingDim: exportPosts
                        ? parseInt(
                            String(process.env.RECOMMENDATION_CONTENT_DENSE_EMBEDDING_DIMENSIONS || '48'),
                            10,
                        ) || 48
                        : previousMetadata!.postEmbeddingDim,
                });
            }

        } finally {
            this.isRunning = false;
        }

        const durationMs = Date.now() - startTime;
        console.log(
            `[FeatureExportJob] Completed in ${durationMs}ms - ` +
            `users: ${usersExported}, clusters: ${clustersExported}, posts: ${postsExported}`
        );

        return { usersExported, clustersExported, postsExported, durationMs };
    }

    /**
     * 导出用户嵌入
     */
    private async exportUserEmbeddings(outputDir: string): Promise<number | undefined> {
        const embeddings: ExportedEmbedding[] = [];
        let processed = 0;

        // 分批读取
        let skip = 0;
        while (processed < CONFIG.maxExportSize) {
            const batch = await UserFeatureVector.find({
                twoTowerEmbedding: { $exists: true, $ne: null },
            })
                .select(
                    'userId twoTowerEmbedding twoTowerEmbeddingContract twoTowerEmbeddingQuarantineReason qualityScore',
                )
                .skip(skip)
                .limit(CONFIG.batchSize);

            if (batch.length === 0) break;

            for (const user of batch) {
                const evidence = classifyEmbeddingContractEvidence({
                    vector: user.twoTowerEmbedding,
                    perVectorContract: user.twoTowerEmbeddingContract,
                    quarantineReason: user.twoTowerEmbeddingQuarantineReason,
                });
                if (
                    evidence === 'semantic_ready'
                    && user.twoTowerEmbedding
                    && user.twoTowerEmbedding.length === CONFIG.userEmbeddingDim
                ) {
                    embeddings.push({
                        id: user.userId,
                        vector: user.twoTowerEmbedding,
                        metadata: {
                            qualityScore: user.qualityScore,
                        },
                    });
                    processed++;
                }
            }

            skip += CONFIG.batchSize;
        }

        if (embeddings.length === 0) {
            return undefined;
        }

        // 写入文件
        const outputPath = path.join(outputDir, CONFIG.files.userEmbeddings);
        await fs.promises.writeFile(outputPath, JSON.stringify(embeddings, null, 2));

        return embeddings.length;
    }

    /**
     * 导出聚类质心
     */
    private async exportClusterCentroids(outputDir: string): Promise<number> {
        const centroids: ExportedEmbedding[] = [];

        const clusters = await ClusterDefinition.find({
            isActive: true,
            centroidEmbedding: { $exists: true, $ne: null },
        })
            .select('clusterId centroidEmbedding name tags')
            .limit(CONFIG.maxExportSize);

        for (const cluster of clusters) {
            if (cluster.centroidEmbedding && cluster.centroidEmbedding.length === CONFIG.clusterEmbeddingDim) {
                centroids.push({
                    id: cluster.clusterId.toString(),
                    vector: cluster.centroidEmbedding,
                    metadata: {
                        name: cluster.name,
                        tags: cluster.tags,
                    },
                });
            }
        }

        // 写入文件
        const outputPath = path.join(outputDir, CONFIG.files.clusterCentroids);
        await fs.promises.writeFile(outputPath, JSON.stringify(centroids, null, 2));

        return centroids.length;
    }

    private async exportPostEmbeddings(outputDir: string): Promise<number> {
        const embeddings: ExportedEmbedding[] = [];
        let skip = 0;

        while (embeddings.length < CONFIG.maxExportSize) {
            const batch = await PostFeatureSnapshot.find({
                denseEmbedding: { $exists: true, $ne: [] },
            })
                .select(
                    'postId authorId denseEmbedding embeddingContract dominantClusterIds qualityScore postCreatedAt engagementBucket freshnessBucket',
                )
                .sort({ postCreatedAt: -1, qualityScore: -1 })
                .skip(skip)
                .limit(CONFIG.batchSize)
                .lean();

            if (batch.length === 0) break;

            for (const post of batch) {
                if (!Array.isArray((post as any).denseEmbedding) || (post as any).denseEmbedding.length === 0) {
                    continue;
                }
                if (
                    !(post as any).embeddingContract
                    || (post as any).embeddingContract.semantic !== true
                    || !isVectorCompatibleWithContract((post as any).denseEmbedding, (post as any).embeddingContract)
                ) {
                    continue;
                }
                embeddings.push({
                    id: String((post as any).postId),
                    vector: (post as any).denseEmbedding,
                    metadata: {
                        authorId: (post as any).authorId,
                        dominantClusterIds: (post as any).dominantClusterIds || [],
                        qualityScore: (post as any).qualityScore,
                        createdAt: (post as any).postCreatedAt,
                        engagementBucket: (post as any).engagementBucket,
                        freshnessBucket: (post as any).freshnessBucket,
                    },
                });

                if (embeddings.length >= CONFIG.maxExportSize) {
                    break;
                }
            }

            skip += CONFIG.batchSize;
        }

        const outputPath = path.join(outputDir, CONFIG.files.postEmbeddings);
        await fs.promises.writeFile(outputPath, JSON.stringify(embeddings, null, 2));
        return embeddings.length;
    }

    /**
     * 写入元数据
     */
    private async writeMetadata(
        outputDir: string,
        artifactMetadata: ExportArtifactMetadata,
    ): Promise<void> {
        const metadata: ExportMetadata = {
            exportedAt: new Date().toISOString(),
            version: Date.now(),
            ...artifactMetadata,
        };

        const outputPath = path.join(outputDir, CONFIG.files.metadata);
        await fs.promises.writeFile(outputPath, JSON.stringify(metadata, null, 2));
    }

    private async readExistingMetadata(outputDir: string): Promise<ExportMetadata> {
        try {
            const contents = await fs.promises.readFile(
                path.join(outputDir, CONFIG.files.metadata),
                'utf8',
            );
            const metadata: unknown = JSON.parse(contents);
            if (!isExportMetadata(metadata)) {
                throw new Error('invalid');
            }
            return metadata;
        } catch {
            throw new Error('feature_export_existing_metadata_invalid');
        }
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.promises.access(filePath);
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return false;
            }
            throw error;
        }
    }

    /**
     * 确保目录存在
     */
    private async ensureDir(dir: string): Promise<void> {
        try {
            await fs.promises.access(dir);
        } catch {
            await fs.promises.mkdir(dir, { recursive: true });
        }
    }

    /**
     * 检查是否正在运行
     */
    get running(): boolean {
        return this.isRunning;
    }
}

// ========== 导出单例 ==========
export const featureExportJob = new FeatureExportJob();
export default featureExportJob;

function isExportMetadata(value: unknown): value is ExportMetadata {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const metadata = value as Partial<ExportMetadata>;
    return typeof metadata.exportedAt === 'string'
        && !Number.isNaN(Date.parse(metadata.exportedAt))
        && isNonNegativeInteger(metadata.version)
        && isNonNegativeInteger(metadata.userCount)
        && isNonNegativeInteger(metadata.clusterCount)
        && isNonNegativeInteger(metadata.postCount)
        && isPositiveInteger(metadata.userEmbeddingDim)
        && isPositiveInteger(metadata.clusterEmbeddingDim)
        && isPositiveInteger(metadata.postEmbeddingDim);
}

function isNonNegativeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) > 0;
}
