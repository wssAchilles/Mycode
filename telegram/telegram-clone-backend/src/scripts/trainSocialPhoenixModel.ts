/**
 * 训练轻量社交 Phoenix 线性模型。
 *
 * 用法：
 *   npx ts-node src/scripts/trainSocialPhoenixModel.ts --input ./tmp/recsys_samples.ndjson --output ./tmp/social_phoenix_model.json
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';

import type {
    SocialPhoenixFeatureMap,
    SocialPhoenixLinearModel,
    SocialPhoenixTask,
} from '../services/recommendation/socialPhoenix';

type SampleRow = {
    trainingFeatures?: SocialPhoenixFeatureMap;
    labelClick?: number;
    labelLike?: number;
    labelReply?: number;
    labelRepost?: number;
    labelQuote?: number;
    labelShare?: number;
    labelEngagement?: number;
    labelNegative?: number;
};

type TaskSpec = {
    task: SocialPhoenixTask;
    label: keyof SampleRow;
};

const TASKS: TaskSpec[] = [
    { task: 'click', label: 'labelClick' },
    { task: 'like', label: 'labelLike' },
    { task: 'reply', label: 'labelReply' },
    { task: 'repost', label: 'labelRepost' },
    { task: 'quote', label: 'labelQuote' },
    { task: 'share', label: 'labelShare' },
    { task: 'engagement', label: 'labelEngagement' },
    { task: 'negative', label: 'labelNegative' },
];

function parseArgs() {
    const args = process.argv.slice(2);
    const kv: Record<string, string> = {};
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (!arg.startsWith('--')) continue;
        const key = arg.slice(2);
        const value = args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : 'true';
        kv[key] = value;
    }

    return {
        input: kv.input || './tmp/recsys_samples.ndjson',
        output: kv.output || './tmp/social_phoenix_model.json',
        epochs: Math.max(1, parseInt(kv.epochs || '8', 10) || 8),
        learningRate: Math.max(0.0001, parseFloat(kv.learningRate || '0.05') || 0.05),
        l2: Math.max(0, parseFloat(kv.l2 || '0.0005') || 0.0005),
        minFeatureCount: Math.max(1, parseInt(kv.minFeatureCount || '4', 10) || 4),
    };
}

function sigmoid(value: number): number {
    if (value >= 0) {
        const z = Math.exp(-value);
        return 1 / (1 + z);
    }
    const z = Math.exp(value);
    return z / (1 + z);
}

async function main() {
    const args = parseArgs();
    const inputPath = path.resolve(process.cwd(), args.input);
    if (!fs.existsSync(inputPath)) {
        throw new Error(`input_not_found:${inputPath}`);
    }

    const rows: SampleRow[] = [];
    const featureCounts = new Map<string, number>();
    const input = readline.createInterface({
        input: fs.createReadStream(inputPath, { encoding: 'utf8' }),
        crlfDelay: Infinity,
    });

    for await (const line of input) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const row = JSON.parse(trimmed) as SampleRow;
        if (!row.trainingFeatures || Object.keys(row.trainingFeatures).length === 0) continue;
        rows.push(row);
        for (const [feature, value] of Object.entries(row.trainingFeatures)) {
            if (!Number.isFinite(value) || value === 0) continue;
            featureCounts.set(feature, (featureCounts.get(feature) || 0) + 1);
        }
    }

    if (rows.length === 0) {
        throw new Error('no_training_rows');
    }

    const features = Array.from(featureCounts.entries())
        .filter(([feature, count]) => feature === 'bias' || count >= args.minFeatureCount)
        .map(([feature]) => feature)
        .sort();

    const model: SocialPhoenixLinearModel = {
        version: 1,
        trainedAt: new Date().toISOString(),
        features,
        tasks: Object.fromEntries(
            TASKS.map(({ task }) => [
                task,
                {
                    bias: 0,
                    weights: Object.fromEntries(features.map((feature) => [feature, 0])),
                },
            ]),
        ) as SocialPhoenixLinearModel['tasks'],
        metadata: {
            rows: rows.length,
            epochs: args.epochs,
            learningRate: args.learningRate,
            l2: args.l2,
        },
    };

    for (const { task, label } of TASKS) {
        const positives = rows.reduce((sum, row) => sum + (Number(row[label] || 0) > 0 ? 1 : 0), 0);
        const positiveWeight = positives > 0 ? rows.length / Math.max(1, positives * 2) : 1;
        const negativeWeight = rows.length > positives ? rows.length / Math.max(1, (rows.length - positives) * 2) : 1;

        for (let epoch = 0; epoch < args.epochs; epoch += 1) {
            for (const row of rows) {
                const taskModel = model.tasks[task];
                const labelValue = Number(row[label] || 0) > 0 ? 1 : 0;
                const sampleWeight = labelValue > 0 ? positiveWeight : negativeWeight;
                let logit = taskModel.bias;

                for (const feature of features) {
                    const value = row.trainingFeatures?.[feature] || 0;
                    if (!Number.isFinite(value) || value === 0) continue;
                    logit += (taskModel.weights[feature] || 0) * value;
                }

                const prediction = sigmoid(logit);
                const gradient = (prediction - labelValue) * sampleWeight;
                taskModel.bias -= args.learningRate * gradient;

                for (const feature of features) {
                    if (feature === 'bias') continue;
                    const value = row.trainingFeatures?.[feature] || 0;
                    if (!Number.isFinite(value) || value === 0) continue;
                    const current = taskModel.weights[feature] || 0;
                    taskModel.weights[feature] =
                        current -
                        args.learningRate * (gradient * value + args.l2 * current);
                }
            }
        }
    }

    const outputPath = path.resolve(process.cwd(), args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(model, null, 2));

    console.log(`[TrainSocialPhoenixModel] rows=${rows.length}`);
    console.log(`[TrainSocialPhoenixModel] features=${features.length}`);
    console.log(`[TrainSocialPhoenixModel] wrote ${outputPath}`);
}

main().catch((error) => {
    console.error('[TrainSocialPhoenixModel] failed:', error);
    process.exitCode = 1;
});
