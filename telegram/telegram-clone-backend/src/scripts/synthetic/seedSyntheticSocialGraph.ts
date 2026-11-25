import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

import {
  cleanupDemoCohort,
  collectExistingDemoState,
} from '../demo/cohortStore';
import { connectDemoStores, disconnectDemoStores } from '../demo/runtime';
import { generateSyntheticPosts } from './contentGenerator';
import {
  SCALE_PROFILES,
  SYNTH_SCRIPT_VERSION,
  type CliOptions,
  type GenerationSummaryReport,
  type SyntheticScalePreset,
} from './contracts';
import {
  buildSyntheticClusterDefinitions,
  buildSyntheticRealGraphEdges,
  buildSyntheticUserFeatureVectors,
  buildSyntheticUserSignals,
} from './featureGenerator';
import {
  generateCorrelatedFollowGraph,
  generateSyntheticUsers,
} from './graphGenerator';
import { generateSyntheticInteractions } from './interactionGenerator';
import { SeededRng } from './prng';
import {
  cleanupSyntheticCohort,
  loadExistingRealUsers,
  persistSyntheticCohort,
  reconcileExistingStoreIntegrity,
  verifySyntheticPostStatsMatch,
} from './storeLifecycle';

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readArg(flag: string): string | null {
  const direct = process.argv.find((arg) => arg.startsWith(`${flag}=`));
  if (direct) return direct.slice(flag.length + 1);
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  return null;
}

function parseCliOptions(): CliOptions {
  const rawScale = (readArg('--scale') || 'large').toLowerCase();
  const scale: SyntheticScalePreset =
    rawScale === 'compact' || rawScale === 'standard' || rawScale === 'large'
      ? rawScale
      : 'large';

  const rawSeed = Number(readArg('--seed'));
  const seed = Number.isFinite(rawSeed) && rawSeed > 0 ? Math.floor(rawSeed) : 20261125;

  const rawTargets = readArg('--attach-users') || '';
  const targetRealUsernames = rawTargets
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    scale,
    seed,
    dryRun: hasFlag('--dry-run'),
    cleanOnly: hasFlag('--clean-only'),
    reset: !hasFlag('--no-reset'),
    purgeDemo: hasFlag('--purge-demo'),
    reconcileExisting: !hasFlag('--skip-reconcile'),
    attachRealUsers: !hasFlag('--no-attach-real'),
    targetRealUsernames,
    password: readArg('--password') || process.env.SYNTHETIC_DEFAULT_PASSWORD || 'SynthGraph2026!',
  };
}

async function main(): Promise<void> {
  const options = parseCliOptions();
  const profile = SCALE_PROFILES[options.scale];
  const rng = new SeededRng(options.seed);

  await connectDemoStores();
  try {
    console.log(
      `[synthetic:seed] start scale=${options.scale} seed=${options.seed} dryRun=${options.dryRun} purgeDemo=${options.purgeDemo}`,
    );

    if (options.cleanOnly) {
      if (options.dryRun) {
        console.log('[synthetic:seed] dry-run clean-only complete');
        return;
      }
      const cleaned = await cleanupSyntheticCohort();
      if (options.purgeDemo) {
        const existingDemo = await collectExistingDemoState();
        await cleanupDemoCohort(existingDemo);
      }
      console.log(JSON.stringify({ cleaned }, null, 2));
      return;
    }

    let orphanSnapshotsCleaned = 0;
    let historicalPostsReconciled = 0;

    if (!options.dryRun) {
      if (options.reset) {
        const cleaned = await cleanupSyntheticCohort();
        console.log(`[synthetic:seed] cleaned previous synthetic cohort: users=${cleaned.removedUsers}, posts=${cleaned.removedPosts}`);
      }
      if (options.purgeDemo) {
        const existingDemo = await collectExistingDemoState();
        if (existingDemo.demoUserIds.length || existingDemo.demoPostIds.length) {
          await cleanupDemoCohort(existingDemo);
          console.log(`[synthetic:seed] purged legacy demo cohort: users=${existingDemo.demoUserIds.length}, posts=${existingDemo.demoPostIds.length}`);
        }
      }
      if (options.reconcileExisting) {
        const reconciled = await reconcileExistingStoreIntegrity();
        orphanSnapshotsCleaned = reconciled.orphanSnapshotsCleaned;
        historicalPostsReconciled = reconciled.historicalPostsReconciled;
        console.log(
          `[synthetic:seed] reconciled existing store: orphanSnapshots=${orphanSnapshotsCleaned}, postsFixed=${historicalPostsReconciled}`,
        );
      }
    }

    // 1) 加载真实注册用户并生成分层合成用户
    const realUsers = options.attachRealUsers
      ? await loadExistingRealUsers(options.targetRealUsernames)
      : [];
    const syntheticUsers = generateSyntheticUsers(profile, rng);

    // 2) 生成 LDBC + SBM 相关性图谱（含真实用户图谱邻域融合）
    const graphResult = generateCorrelatedFollowGraph({
      syntheticUsers,
      realUsersToAttach: realUsers,
      rng,
    });
    const allActors = [...syntheticUsers, ...graphResult.attachedUsers];

    // 3) 生成幂律密度 + Flashmob 热点脉冲内容与引用贴
    const posts = generateSyntheticPosts({
      users: syntheticUsers,
      attachedRealUsers: graphResult.attachedUsers,
      profile,
      rng,
    });

    // 4) 生成自洽的真实互动与推荐流水，严格对账聚合 Post.stats
    const interactions = generateSyntheticInteractions({
      allActors,
      posts,
      outNeighborsMap: graphResult.outNeighborsMap,
      followEdges: graphResult.edges,
      profile,
      rng,
    });

    // 5) 聚合生成 RealGraphEdge、UserSignal、合规 UserFeatureVector、ClusterDefinition
    const realGraphEdges = buildSyntheticRealGraphEdges({
      followEdges: graphResult.edges,
      actions: interactions.actions,
      allUsers: allActors,
    });
    const signals = buildSyntheticUserSignals(interactions.actions);
    const userFeatureVectors = buildSyntheticUserFeatureVectors(allActors);
    const clusterDefinitions = buildSyntheticClusterDefinitions({
      allUsers: allActors,
      posts,
      statsByPostId: interactions.statsByPostId,
      rng,
    });

    // 计算图度统计
    const sortedTopKols = syntheticUsers
      .map((u) => ({
        username: u.username,
        inDegree: graphResult.inDegreeMap.get(u.id) || 0,
      }))
      .sort((a, b) => b.inDegree - a.inDegree)
      .slice(0, 5);
    const maxInDegree = sortedTopKols[0]?.inDegree || 0;
    const avgOutDegree = Number((graphResult.edges.length / Math.max(1, allActors.length)).toFixed(2));
    const sevenDaysMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent7dPosts = posts.filter((p) => p.createdAt.getTime() >= sevenDaysMs).length;

    let timelineEntries = recent7dPosts;
    let postStatsExactMatch = true;
    let mismatchedPostCount = 0;

    if (!options.dryRun) {
      const passwordHash = await bcrypt.hash(options.password, 10);
      const persisted = await persistSyntheticCohort({
        users: syntheticUsers,
        attachedRealUsers: graphResult.attachedUsers,
        passwordHash,
        followEdges: graphResult.edges,
        posts,
        statsByPostId: interactions.statsByPostId,
        likes: interactions.likes,
        comments: interactions.comments,
        reposts: interactions.reposts,
        actions: interactions.actions,
        signals,
        realGraphEdges,
        userFeatureVectors,
        clusterDefinitions,
      });
      timelineEntries = persisted.timelineEntries;

      const verification = await verifySyntheticPostStatsMatch(posts.map((p) => p._id));
      postStatsExactMatch = verification.exactMatch;
      mismatchedPostCount = verification.mismatchedCount;
    }

    const report: GenerationSummaryReport = {
      scriptVersion: SYNTH_SCRIPT_VERSION,
      preset: options.scale,
      seed: options.seed,
      dryRun: options.dryRun,
      users: {
        syntheticTotal: syntheticUsers.length,
        realAttached: graphResult.attachedUsers.length,
        byTier: {
          kol: profile.kolCount,
          bridge: profile.bridgeCount,
          creator: profile.creatorCount,
          reader: profile.readerCount,
        },
      },
      graph: {
        followEdges: graphResult.edges.length,
        realGraphEdges: realGraphEdges.length,
        avgOutDegree,
        maxInDegree,
        topKolUsernames: sortedTopKols,
      },
      content: {
        posts: posts.length,
        quotePosts: posts.filter((p) => p.isQuote).length,
        flashmobPosts: posts.filter((p) => p.isFlashmob).length,
        recent7dPosts,
        postFeatureSnapshots: posts.length,
        timelineZsetEntries: timelineEntries,
      },
      interactions: {
        likes: interactions.likes.length,
        topLevelComments: interactions.comments.filter((c) => c.parentId == null).length,
        nestedReplies: interactions.comments.filter((c) => c.parentId != null).length,
        reposts: interactions.reposts.length,
        userActions: interactions.actions.length,
        userSignals: signals.length,
        negativeActions: interactions.negativeActionCount,
      },
      integrityChecks: {
        postStatsExactMatch,
        mismatchedPostCount,
        orphanSnapshotsCleaned,
        historicalPostsReconciled,
      },
    };

    console.log(JSON.stringify(report, null, 2));
    if (!postStatsExactMatch) {
      throw new Error(`post stats integrity verification failed: mismatchedCount=${mismatchedPostCount}`);
    }
  } finally {
    mongoose.connection.removeAllListeners('disconnected');
    mongoose.connection.removeAllListeners('error');
    await disconnectDemoStores();
  }
}

if (require.main === module) {
  main()
    .then(() => {
      process.exit(0);
    })
    .catch(async (error) => {
      console.error('[synthetic:seed] failed:', error);
      mongoose.connection.removeAllListeners('disconnected');
      mongoose.connection.removeAllListeners('error');
      await disconnectDemoStores();
      process.exit(1);
    });
}
