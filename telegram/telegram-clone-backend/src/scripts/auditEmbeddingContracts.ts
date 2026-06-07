import mongoose from 'mongoose';
import dotenv from 'dotenv';

import { connectMongoDB } from '../config/db';
import UserFeatureVector from '../models/UserFeatureVector';
import PostFeatureSnapshot from '../models/PostFeatureSnapshot';
import { isVectorCompatibleWithContract } from '../services/recommendation/contracts/embeddingContract';

dotenv.config();

function parseArgs() {
    const args = process.argv.slice(2);
    const kv: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : 'true';
        kv[key] = value;
    }
    return {
        limit: Math.max(1, parseInt(kv.limit || '5000', 10) || 5000),
    };
}

async function main() {
    const { limit } = parseArgs();
    await connectMongoDB();

    const [users, posts] = await Promise.all([
        UserFeatureVector.find({}).limit(limit).lean(),
        PostFeatureSnapshot.find({}).limit(limit).lean(),
    ]);

    const userDims = countDimensions(users.map((doc: any) => doc.phoenixEmbedding || doc.twoTowerEmbedding || []));
    const postDims = countDimensions(posts.map((doc: any) => doc.denseEmbedding || []));
    const userContracts = users.filter((doc: any) => doc.embeddingContract?.artifactVersion).length;
    const postContracts = posts.filter((doc: any) => doc.embeddingContract?.artifactVersion).length;
    const incompatibleUsers = users.filter((doc: any) => {
        const vector = doc.phoenixEmbedding || doc.twoTowerEmbedding || [];
        return doc.embeddingContract && !isVectorCompatibleWithContract(vector, doc.embeddingContract);
    }).length;
    const incompatiblePosts = posts.filter((doc: any) => (
        doc.embeddingContract && !isVectorCompatibleWithContract(doc.denseEmbedding || [], doc.embeddingContract)
    )).length;

    console.log(JSON.stringify({
        sampled: {
            users: users.length,
            postFeatureSnapshots: posts.length,
        },
        dimensionDistribution: {
            userVectors: userDims,
            postFeatureSnapshots: postDims,
        },
        artifactVersionCoverage: {
            userVectors: ratio(userContracts, users.length),
            postFeatureSnapshots: ratio(postContracts, posts.length),
        },
        incompatibleSamples: {
            userVectors: incompatibleUsers,
            postFeatureSnapshots: incompatiblePosts,
        },
    }, null, 2));
}

function countDimensions(vectors: unknown[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const vector of vectors) {
        const dim = Array.isArray(vector) ? vector.length : 0;
        counts[String(dim)] = (counts[String(dim)] || 0) + 1;
    }
    return counts;
}

function ratio(count: number, total: number): number {
    return total > 0 ? Number((count / total).toFixed(4)) : 0;
}

main()
    .catch((error) => {
        console.error('[AuditEmbeddingContracts] failed:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        try {
            mongoose.connection.removeAllListeners('disconnected');
            mongoose.connection.removeAllListeners('error');
            await mongoose.disconnect();
        } catch {
            // ignore
        }
    });
