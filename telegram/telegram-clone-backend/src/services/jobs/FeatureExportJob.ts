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
    embeddingDim: 64,                  // Two-Tower 维度

    // 文件名
    files: {
        userEmbeddings: 'user_embeddings.json',
        clusterCentroids: 'cluster_centroids.json',
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
    embeddingDim: number;
}

// ========== 作业类 ==========
export class FeatureExportJob {
    private isRunning = false;

    /**
     * 运行导出作业
     */
    async run(options?: {
        onlyUsers?: boolean;
        onlyClusters?: boolean;
        outputDir?: string;
    }): Promise<{
        usersExported: number;
        clustersExported: number;
        durationMs: number;
    }> {
        if (this.isRunning) {
            throw new Error('[FeatureExportJob] Job is already running');
        }

        this.isRunning = true;
        const startTime = Date.now();
        let usersExported = 0;
        let clustersExported = 0;

        const outputDir = options?.outputDir || CONFIG.exportDir;

        try {
            console.log('[FeatureExportJob] Starting export job...');

            // 确保输出目录存在
            await this.ensureDir(outputDir);

            // 导出用户嵌入
            if (!options?.onlyClusters) {
                usersExported = await this.exportUserEmbeddings(outputDir);
                console.log(`[FeatureExportJob] Exported ${usersExported} user embeddings`);
            }

            // 导出聚类质心
            if (!options?.onlyUsers) {
                clustersExported = await this.exportClusterCentroids(outputDir);
                console.log(`[FeatureExportJob] Exported ${clustersExported} cluster centroids`);
            }

            // 写入元数据
            await this.writeMetadata(outputDir, usersExported, clustersExported);

        } finally {
            this.isRunning = false;
        }

        const durationMs = Date.now() - startTime;
        console.log(
            `[FeatureExportJob] Completed in ${durationMs}ms - ` +
            `users: ${usersExported}, clusters: ${clustersExported}`
        );

        return { usersExported, clustersExported, durationMs };
    }

    /**
     * 导出用户嵌入
     */
    private async exportUserEmbeddings(outputDir: string): Promise<number> {
        const embeddings: ExportedEmbedding[] = [];
        let processed = 0;

        // 分批读取
        let skip = 0;
        while (processed < CONFIG.maxExportSize) {
            const batch = await UserFeatureVector.find({
                twoTowerEmbedding: { $exists: true, $ne: null },
            })
                .select('userId twoTowerEmbedding qualityScore')
                .skip(skip)
                .limit(CONFIG.batchSize);

            if (batch.length === 0) break;

            for (const user of batch) {
                if (user.twoTowerEmbedding && user.twoTowerEmbedding.length === CONFIG.embeddingDim) {
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
            if (cluster.centroidEmbedding && cluster.centroidEmbedding.length === CONFIG.embeddingDim) {
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

    /**
     * 写入元数据
     */
    private async writeMetadata(
        outputDir: string,
        userCount: number,
        clusterCount: number
    ): Promise<void> {
        const metadata: ExportMetadata = {
            exportedAt: new Date().toISOString(),
            version: Date.now(),
            userCount,
            clusterCount,
            embeddingDim: CONFIG.embeddingDim,
        };

        const outputPath = path.join(outputDir, CONFIG.files.metadata);
        await fs.promises.writeFile(outputPath, JSON.stringify(metadata, null, 2));
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
