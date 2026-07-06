# Recommendation Algorithm Industrialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing Space Feed recommendation algorithm stack into a production-grade, replayable, diagnosable, staged rollout system while preserving the current Node fallback path and moving durable algorithm ownership toward Rust.

**Architecture:** Keep the current multi-runtime split: Node owns product adapters and fallback, Rust owns the long-term candidate pipeline, Python owns ML retrieval/ranking services, C++ owns low-latency graph kernel queries, and the frontend owns exposure/action telemetry. The implementation order prioritizes contracts, logs, feature consistency, graph snapshot safety, replay evaluation, and rollout gates before adding heavier models such as full SimClusters, TwHIN, GNN, or online learning.

**Tech Stack:** TypeScript/Node, React/Vite frontend, Rust recommendation workspace, Python FastAPI ML services, C++ graph kernel service, MongoDB, Postgres, Redis, graphify/codebase-memory, existing npm/cargo/cmake verification scripts.

---

## Evidence Summary

### Local Code Feasibility

- The current feed path already has an industrial skeleton:
  - Node API/feed orchestration: `telegram-clone-backend/src/services/spaceService.ts`
  - Node baseline pipeline: `telegram-clone-backend/src/services/recommendation/SpaceFeedMixer.ts`
  - Node pipeline framework: `telegram-clone-backend/src/services/recommendation/framework/Pipeline.ts`
  - Rust runtime bridge: `telegram-clone-backend/src/services/recommendation/feed/rustFeedRuntime.ts`
  - Rust candidate pipeline stages: `telegram-rust-workspace/crates/telegram-rust-recommendation/src/pipeline/executor/*`
  - Python ML endpoint: `ml-services/app.py` route `POST /feed/recommend`
  - C++ graph kernel: `telegram-cpp-graph-service/src/main.cpp`
- The algorithm idea is feasible: it already matches the dominant industrial funnel: multi-source retrieval, feature hydration, pre-score filters, ranking/scoring, top-k selection/diversity, post-selection filters, side effects, trace, replay, and staged rollout.
- The weak points are not the algorithm direction. The weak points are contract drift, feedback idempotency, feature/version consistency, snapshot consistency, duplicated scheduler surfaces, diagnostics loss, and split Space/news feedback loops.

### External Research Inputs

- X/Twitter: Home Mixer, RealGraph, GraphJet, SimClusters, TwHIN, Light/Heavy Ranker. Relevant because the project already mirrors multi-source feed mixing, social graph affinity, graph kernel retrieval, community embeddings, and Phoenix-like OON ranking.
- Meta/Instagram/YouTube/LinkedIn/Pinterest: multi-stage retrieval/ranking, TwoTower/ANN, near-real-time features, replay/A-B workflows, graph embeddings.
- Research directions with highest near-term fit:
  - RealGraph as user-user/author affinity features.
  - SimClusters as simplified sparse community/interest vectors before full upstream-scale implementation.
  - TwoTower + ANN as the first robust OON retrieval path.
  - LambdaMART/GBDT or simple weighted ranker as the first explainable production ranker.
  - Counterfactual/replay logging now, complex OPE only after propensity/randomized exposure exists.
- Research directions to delay:
  - Full PinSage/GraphSAGE/GNN production path.
  - TwHIN-scale heterogeneous graph training.
  - Online learning/parameter-server style serving.
  - Slate RL or long-horizon reinforcement learning.

Reference links:
- X algorithm: https://github.com/twitter/the-algorithm
- GraphJet VLDB: https://www.vldb.org/pvldb/vol9/p1281-sharma.pdf
- SimClusters KDD: https://www.kdd.org/kdd2020/accepted-papers/view/simclusters-community-based-representations-for-heterogeneous-recommendatio
- TwHIN: https://arxiv.org/pdf/2202.05387
- YouTube DNN recommendations: https://research.google/pubs/deep-neural-networks-for-youtube-recommendations/
- PinSage: https://arxiv.org/abs/1806.01973
- GraphSAGE: https://arxiv.org/abs/1706.02216
- LightGCN: https://arxiv.org/abs/2002.02126
- Feast point-in-time retrieval: https://docs.feast.dev/getting-started/concepts/feature-retrieval.md
- Open Bandit Pipeline: https://zr-obp.readthedocs.io/en/latest/

---

## Target File Structure

Do not add more flat peer files into crowded recommendation directories. Use the existing layered folders and add bounded subfolders only where a new responsibility appears.

- Modify: `telegram-clone-backend/src/services/recommendation/types/FeedCandidate.ts`
  - Owns backend candidate metadata and stable recommendation context shape.
- Modify: `telegram-clone-backend/src/services/recommendation/adapters/spaceFeedResponseAdapter.ts`
  - Maps internal candidate state to frontend response fields.
- Modify: `telegram-clone-frontend/src/services/spaceApi.ts`
  - Owns frontend `PostResponse` and feed API mapping.
- Modify: `telegram-clone-backend/src/services/eventStreamService.ts`
  - Bridges frontend analytics into recommendation events.
- Modify: `telegram-clone-backend/src/services/recommendation/events/types.ts`
  - Defines recommendation event metadata and idempotency fields.
- Modify: `telegram-clone-backend/src/services/recommendation/events/recordRecommendationEvent.ts`
  - Central durable recommendation event writer.
- Modify: `telegram-clone-backend/src/routes/newsRoutes.ts`
  - Bridges news events into the same recommendation feedback surface.
- Modify: `telegram-clone-backend/src/services/newsService.ts`
  - Preserves existing news counters while emitting unified recommendation feedback.
- Modify: `telegram-clone-backend/src/services/graphKernel/contracts.ts`
  - Adds diagnostics and snapshot consistency fields used by graph retrieval.
- Modify: `telegram-clone-backend/src/services/graphKernel/kernelClient.ts`
  - Preserves graph kernel diagnostics instead of dropping them.
- Modify: `telegram-clone-backend/src/services/graphKernel/snapshotService.ts`
  - Moves snapshot export from offset/skip to stable keyset cursor and snapshot version.
- Modify: `telegram-cpp-graph-service/src/contracts/types.h`
  - Keeps C++ graph response diagnostics aligned with Node contract.
- Modify: `telegram-cpp-graph-service/src/http/routes/graph_routes.cpp`
  - Returns diagnostics consistently for graph query responses.
- Modify: `telegram-clone-backend/src/bootstrap/scheduler.ts`
  - Removes duplicate default execution paths for RealGraph decay and SimClusters batch.
- Modify: `telegram-clone-backend/src/services/jobs/DailyRecommendationRefreshJob.ts`
  - Makes the daily refresh job the canonical scheduled recommendation maintenance path.
- Modify: `telegram-clone-backend/src/services/recommendation/contentFeatures/PostFeatureSnapshotService.ts`
  - Makes heuristic embedding provenance explicit and stable.
- Modify: `telegram-clone-backend/src/services/recommendation/replay/evaluator.ts`
  - Adds candidate-source and logging-readiness checks to replay evaluation.
- Modify: `telegram-rust-workspace/crates/telegram-rust-recommendation/src/replay/evaluator.rs`
  - Keeps Rust replay metrics aligned with Node replay metrics.
- Create: `telegram-clone-backend/docs/recommendation/industrialization-checklist.md`
  - Documents rollout gates, evidence checks, and ownership decisions.

---

## Success Criteria

1. Every served Space Feed item can be joined by `requestId + rank + postId` to candidate source, score, selection reason, experiment keys, and later user feedback.
2. News feed events can be evaluated together with Space feed events instead of living in a separate feedback silo.
3. Graph kernel responses carry `snapshotVersion`, truncation, budget, and empty-reason diagnostics through Node/Rust traces.
4. RealGraph decay and SimClusters batch have one default scheduled owner, with manual jobs retained only as explicit repair paths.
5. Embedding and feature vectors never silently mix incompatible spaces, dimensions, or model versions.
6. Replay reports can detect whether a candidate source, scorer, or selector change improved ranking metrics without relying only on online traffic.
7. Rust primary rollout remains gated by trace, fallback, latency, and contract evidence.

---

### Task 1: Stable Recommendation Context Contract
> Implementation status (2026-07-06): Task 1 and Task 2 completed. Verified backend recommendation context contract, frontend feed mapping contract, idempotent recommendation event writes, news feedback bridge, Redis clientEventId readback, model index contracts, and backend typecheck. Frontend full app typecheck still fails on pre-existing unrelated debt (172 errors across 38 files after this change); targeted frontend contract test passes.


**Files:**
- Modify: `telegram-clone-backend/src/services/recommendation/types/FeedCandidate.ts`
- Modify: `telegram-clone-backend/src/services/recommendation/adapters/spaceFeedResponseAdapter.ts`
- Modify: `telegram-clone-frontend/src/services/spaceApi.ts`
- Test: `telegram-clone-backend/tests/recommendation/recommendationContextContract.test.ts`
- Test: `telegram-clone-frontend/src/test/spaceFeedContract.test.ts`

- [x] **Step 1: Write backend contract test**

Create `telegram-clone-backend/tests/recommendation/recommendationContextContract.test.ts`:

```ts
import { transformFeedCandidateToResponse } from '../../src/services/recommendation/adapters/spaceFeedResponseAdapter';
import { createFeedCandidate } from '../../src/services/recommendation/types/FeedCandidate';

describe('recommendation context response contract', () => {
  it('exposes stable context fields without debug trace', () => {
    const candidate = createFeedCandidate({
      postId: 'post_1',
      authorId: 'author_1',
      content: 'hello',
      createdAt: new Date('2026-07-06T00:00:00.000Z'),
      score: 0.72,
      weightedScore: 0.81,
      recallSource: 'GraphSource',
      secondaryRecallSources: ['TwoTowerSource'],
      recallEvidence: [{ source: 'GraphSource', score: 0.7, reason: 'social_neighbor' }],
      selectionPool: 'main',
      selectionReason: 'top_k',
      recommendationRequestId: 'req_1',
      recommendationRank: 3,
      experimentKeys: ['space_feed_recsys:treatment'],
    } as any);

    const response = transformFeedCandidateToResponse(candidate, { debug: false } as any);

    expect(response._recommendationContext).toEqual({
      requestId: 'req_1',
      rank: 3,
      primarySource: 'GraphSource',
      secondarySources: ['TwoTowerSource'],
      recallEvidence: [{ source: 'GraphSource', score: 0.7, reason: 'social_neighbor' }],
      selectionPool: 'main',
      selectionReason: 'top_k',
      score: 0.72,
      weightedScore: 0.81,
      experimentKeys: ['space_feed_recsys:treatment'],
    });
    expect(response._recommendationTrace).toBeUndefined();
  });
});
```

- [x] **Step 2: Run backend contract test and confirm failure**

Run:

```bash
cd /Users/achilles/Documents/telegram_code/telegram/telegram-clone-backend
npm test -- tests/recommendation/recommendationContextContract.test.ts
```

Expected: FAIL because `_recommendationContext` is not yet returned as one stable object.

- [x] **Step 3: Add backend context type**

Add this exported type to `telegram-clone-backend/src/services/recommendation/types/FeedCandidate.ts` near the candidate metadata types:

```ts
export interface RecommendationContext {
  requestId?: string;
  rank?: number;
  primarySource?: string;
  secondarySources: string[];
  recallEvidence: Array<Record<string, unknown>>;
  selectionPool?: string;
  selectionReason?: string;
  score?: number;
  weightedScore?: number;
  experimentKeys: string[];
}
```

Add `recommendationContext?: RecommendationContext` only if the local candidate type already stores response-specific metadata separately; otherwise compute it in the adapter from existing fields to avoid duplicating state.

- [x] **Step 4: Map context in response adapter**

In `telegram-clone-backend/src/services/recommendation/adapters/spaceFeedResponseAdapter.ts`, add:

```ts
function buildRecommendationContext(candidate: FeedCandidate): RecommendationContext {
  return {
    requestId: candidate.recommendationRequestId,
    rank: candidate.recommendationRank,
    primarySource: candidate.recallSource,
    secondarySources: candidate.secondaryRecallSources ?? [],
    recallEvidence: candidate.recallEvidence ?? [],
    selectionPool: candidate.selectionPool,
    selectionReason: candidate.selectionReason,
    score: candidate.score,
    weightedScore: candidate.weightedScore,
    experimentKeys: candidate.experimentKeys ?? [],
  };
}
```

Then set:

```ts
_recommendationContext: buildRecommendationContext(candidate),
```

Keep existing flat fields during migration so current frontend code does not break.

- [x] **Step 5: Add frontend type coverage**

In `telegram-clone-frontend/src/services/spaceApi.ts`, extend `PostResponse`:

```ts
export interface RecommendationContext {
  requestId?: string;
  rank?: number;
  primarySource?: string;
  secondarySources: string[];
  recallEvidence: Array<Record<string, unknown>>;
  selectionPool?: string;
  selectionReason?: string;
  score?: number;
  weightedScore?: number;
  experimentKeys: string[];
}

export interface PostResponse {
  _recommendationContext?: RecommendationContext;
}
```

Keep existing `_recallSource`, `_recommendationRank`, `_recommendationScore`, `_weightedScore`, `_selectionPool`, and `_selectionReason` fields until all analytics consumers switch to `_recommendationContext`.

- [x] **Step 6: Run verification**

Run:

```bash
cd /Users/achilles/Documents/telegram_code/telegram/telegram-clone-backend
npm test -- tests/recommendation/recommendationContextContract.test.ts
cd /Users/achilles/Documents/telegram_code/telegram/telegram-clone-frontend
npm run typecheck
```

Expected: PASS.

---

### Task 2: Unified Idempotent Feedback Surface

**Files:**
- Modify: `telegram-clone-backend/src/services/recommendation/events/types.ts`
- Modify: `telegram-clone-backend/src/services/recommendation/events/recordRecommendationEvent.ts`
- Modify: `telegram-clone-backend/src/services/eventStreamService.ts`
- Modify: `telegram-clone-backend/src/routes/newsRoutes.ts`
- Modify: `telegram-clone-backend/src/services/newsService.ts`
- Modify: `telegram-clone-backend/src/models/UserAction.ts`
- Modify: `telegram-clone-backend/src/models/UserSignal.ts`
- Test: `telegram-clone-backend/tests/recommendation/recommendationEventIdempotency.test.ts`
- Test: `telegram-clone-backend/tests/news/newsRecommendationBridge.test.ts`

- [x] **Step 1: Write idempotency regression test**

Create `telegram-clone-backend/tests/recommendation/recommendationEventIdempotency.test.ts`:

```ts
import { recordRecommendationEvents } from '../../src/services/recommendation/events/recordRecommendationEvent';
import { UserAction } from '../../src/models/UserAction';
import { UserSignal } from '../../src/models/UserSignal';

describe('recommendation event idempotency', () => {
  it('does not duplicate durable actions or signals for the same event key', async () => {
    const event = {
      clientEventId: 'evt_space_1',
      userId: 'user_1',
      eventType: 'impression',
      targetType: 'post',
      targetId: 'post_1',
      productSurface: 'space_feed',
      requestId: 'req_1',
      rank: 1,
      score: 0.5,
      recallSource: 'GraphSource',
      occurredAt: new Date('2026-07-06T00:00:00.000Z'),
    } as any;

    await recordRecommendationEvents([event]);
    await recordRecommendationEvents([event]);

    expect(await UserAction.countDocuments({ 'metadata.clientEventId': 'evt_space_1' })).toBe(1);
    expect(await UserSignal.countDocuments({ 'metadata.clientEventId': 'evt_space_1' })).toBeLessThanOrEqual(1);
  });
});
```

- [x] **Step 2: Add event key contract**

In `telegram-clone-backend/src/services/recommendation/events/types.ts`, add:

```ts
export interface RecommendationEventIdentity {
  clientEventId?: string;
  recommendationEventKey: string;
}

export function buildRecommendationEventKey(input: {
  clientEventId?: string;
  userId: string;
  eventType: string;
  targetId: string;
  requestId?: string;
  rank?: number;
  occurredAt?: Date | string;
}): string {
  if (input.clientEventId) return input.clientEventId;
  return [
    input.userId,
    input.eventType,
    input.targetId,
    input.requestId ?? 'no_request',
    input.rank ?? 'no_rank',
  ].join(':');
}
```

- [x] **Step 3: Upsert instead of blind insert**

In `recordRecommendationEvent.ts`, compute `recommendationEventKey` once per input and write it into `metadata.recommendationEventKey`.

Use an upsert shape for durable writes:

```ts
await UserAction.updateOne(
  { 'metadata.recommendationEventKey': eventKey },
  { $setOnInsert: actionDocument },
  { upsert: true },
);
```

For `UserSignal`, use the same event key when the signal is durable enough to dedupe. If the current signal writer only supports batch insert, add a small `logSignalsIdempotentBatch()` path instead of changing all signal call sites.

- [x] **Step 4: Add database indexes**

In `UserAction.ts` and `UserSignal.ts`, add sparse unique indexes:

```ts
UserActionSchema.index(
  { 'metadata.recommendationEventKey': 1 },
  {
    unique: true,
    sparse: true,
    name: 'uniq_recommendation_event_key',
  },
);
```

For `UserSignal`, use a partial/sparse index only if expired TTL documents do not make the index unsafe for existing duplicate data. If duplicates already exist in production, add a dry-run audit script before enabling uniqueness.

- [x] **Step 5: Bridge news events into recommendation events**

In `newsRoutes.ts`, keep the existing `/api/news/events` behavior, then call a new `newsService.recordRecommendationFeedback()` that emits:

```ts
{
  userId,
  eventType,
  targetType: 'post',
  targetId: postId,
  productSurface: 'news_feed',
  requestId,
  rank,
  recallSource: source ?? 'NewsFeed',
  modelPostId: externalId,
  clientEventId,
}
```

Do not remove existing `NewsUserEvent` counters in this task.

- [x] **Step 6: Run verification**

Run:

```bash
cd /Users/achilles/Documents/telegram_code/telegram/telegram-clone-backend
npm test -- tests/recommendation/recommendationEventIdempotency.test.ts tests/news/newsRecommendationBridge.test.ts
```

Expected: PASS.

---

### Task 3: Graph Kernel Snapshot Consistency And Diagnostics

**Files:**
- Modify: `telegram-clone-backend/src/services/graphKernel/contracts.ts`
- Modify: `telegram-clone-backend/src/services/graphKernel/kernelClient.ts`
- Modify: `telegram-clone-backend/src/services/graphKernel/snapshotService.ts`
- Modify: `telegram-cpp-graph-service/src/contracts/types.h`
- Modify: `telegram-cpp-graph-service/src/http/routes/graph_routes.cpp`
- Modify: `telegram-rust-workspace/crates/telegram-recommendation-contracts/src/contracts/graph_provider.rs`
- Test: `telegram-clone-backend/tests/graphKernel/diagnosticsContract.test.ts`
- Test: `telegram-cpp-graph-service/tests/graph_store_tests.cpp`

- [x] **Step 1: Write Node diagnostics contract test**

Create `telegram-clone-backend/tests/graphKernel/diagnosticsContract.test.ts`:

```ts
import { parseGraphKernelCandidateResponse } from '../../src/services/graphKernel/kernelClient';

describe('graph kernel diagnostics contract', () => {
  it('preserves graph diagnostics for traces and degrade decisions', () => {
    const parsed = parseGraphKernelCandidateResponse({
      candidates: [{ authorId: 'author_1', score: 0.6, source: 'social_neighbors' }],
      diagnostics: {
        snapshotVersion: 'snapshot_2026_07_06',
        budgetExhausted: false,
        truncatedCount: 3,
        emptyReason: null,
      },
    });

    expect(parsed.diagnostics).toEqual({
      snapshotVersion: 'snapshot_2026_07_06',
      budgetExhausted: false,
      truncatedCount: 3,
      emptyReason: null,
    });
  });
});
```

- [x] **Step 2: Add shared diagnostics shape**

In `graphKernel/contracts.ts`, add:

```ts
export interface GraphKernelDiagnostics {
  snapshotVersion?: string;
  budgetExhausted?: boolean;
  truncatedCount?: number;
  emptyReason?: string | null;
}

export interface GraphKernelCandidateResponse {
  candidates: GraphKernelCandidate[];
  diagnostics?: GraphKernelDiagnostics;
}
```

- [x] **Step 3: Preserve diagnostics in Node client**

In `kernelClient.ts`, change parsing from "candidates only" to:

```ts
return {
  candidates: parseGraphKernelCandidates(payload.candidates),
  diagnostics: parseGraphKernelDiagnostics(payload.diagnostics),
};
```

Thread `diagnostics` into GraphSource trace metadata instead of dropping it at the client boundary.

- [x] **Step 4: Replace offset snapshot pagination with keyset cursor**

In `snapshotService.ts`, add request fields:

```ts
export interface GraphKernelSnapshotPageRequest {
  limit: number;
  afterSourceUserId?: string;
  afterTargetUserId?: string;
  afterId?: string;
  snapshotVersion?: string;
  minScore?: number;
}
```

Sort by `{ sourceUserId: 1, targetUserId: 1, _id: 1 }` and build the next cursor from the final edge. Reject a request if `snapshotVersion` does not match the version selected at page 1.

- [x] **Step 5: Align C++ response**

In `telegram-cpp-graph-service/src/contracts/types.h`, make sure response types include:

```cpp
struct GraphQueryDiagnostics {
  std::string snapshotVersion;
  bool budgetExhausted = false;
  std::size_t truncatedCount = 0;
  std::optional<std::string> emptyReason;
};
```

In `graph_routes.cpp`, serialize the same field names: `snapshotVersion`, `budgetExhausted`, `truncatedCount`, `emptyReason`.

- [x] **Step 6: Run verification**

Run:

```bash
cd /Users/achilles/Documents/telegram_code/telegram/telegram-clone-backend
npm test -- tests/graphKernel/diagnosticsContract.test.ts
cd /Users/achilles/Documents/telegram_code/telegram/telegram-cpp-graph-service
cmake --build --preset release --target graph-store-tests
ctest --preset release --output-on-failure
```

Expected: PASS.

Implementation status:
- Node graph kernel responses now preserve `diagnostics` through explicit parser helpers while retaining array-returning client methods for existing callers.
- GraphSource records graph-kernel diagnostics and materializer diagnostics through `stageDetail`, so trace metadata can observe snapshot/version/truncation signals without changing candidate contracts.
- Snapshot pagination now supports keyset cursor fields and rejects stale `snapshotVersion`; `offset/nextOffset` remain temporarily compatible for the existing C++ snapshot loader.
- C++ diagnostics serialization now emits stable `emptyReason` field names including `null`, and Rust contracts parse the C++ snapshot/pruning/budget diagnostics fields.
- Verification passed with backend graph-kernel tests, backend `tsc`, Rust graph-provider contract tests, and C++ release graph-store tests. The documented `ctest --preset release` command could not be used because this repository defines no `release` test preset; verification used `ctest --test-dir build/release --output-on-failure`.

---

### Task 4: Scheduler Ownership And Repair-Only Jobs

**Files:**
- Modify: `telegram-clone-backend/src/bootstrap/scheduler.ts`
- Modify: `telegram-clone-backend/src/services/jobs/DailyRecommendationRefreshJob.ts`
- Modify: `telegram-clone-backend/src/services/jobs/RealGraphDecayJob.ts`
- Modify: `telegram-clone-backend/src/services/jobs/SimClustersBatchJob.ts`
- Test: `telegram-clone-backend/tests/recommendation/schedulerOwnership.test.ts`

- [x] **Step 1: Write ownership test**

Create `telegram-clone-backend/tests/recommendation/schedulerOwnership.test.ts`:

```ts
import { buildRecommendationSchedulePlan } from '../../src/bootstrap/scheduler';

describe('recommendation scheduler ownership', () => {
  it('uses daily refresh as the only default RealGraph and SimClusters scheduled owner', () => {
    const plan = buildRecommendationSchedulePlan({ enableRepairJobs: false });
    expect(plan.defaultJobs.map((job) => job.name)).toContain('daily-recommendation-refresh');
    expect(plan.defaultJobs.map((job) => job.name)).not.toContain('realgraph-decay-repair');
    expect(plan.defaultJobs.map((job) => job.name)).not.toContain('simclusters-batch-repair');
  });
});
```

- [x] **Step 2: Extract schedule plan builder**

In `scheduler.ts`, add a pure builder:

```ts
export function buildRecommendationSchedulePlan(input: { enableRepairJobs: boolean }) {
  const defaultJobs = [{ name: 'daily-recommendation-refresh', hour: 2, minute: 0 }];
  const repairJobs = input.enableRepairJobs
    ? [
        { name: 'simclusters-batch-repair', hour: 3, minute: 0 },
        { name: 'realgraph-decay-repair', hour: 4, minute: 0 },
      ]
    : [];
  return { defaultJobs, repairJobs };
}
```

Use this builder inside `registerCronJobs()` so the default runtime has one scheduled owner.

- [x] **Step 3: Make repair jobs explicit**

Gate standalone `SimClustersBatchJob` and `RealGraphDecayJob` scheduling behind:

```ts
const enableRecommendationRepairJobs = process.env.RECOMMENDATION_REPAIR_JOBS_ENABLED === 'true';
```

Keep their CLI/manual invocation paths unchanged.

- [x] **Step 4: Persist repair job evidence**

When standalone repair jobs run, write the same `RecommendationJobRun` style metadata used by `DailyRecommendationRefreshJob`, including:

```ts
{
  jobName: 'realgraph-decay-repair',
  mode: 'repair',
  startedAt,
  finishedAt,
  status,
  counts,
}
```

- [x] **Step 5: Run verification**

Run:

```bash
cd /Users/achilles/Documents/telegram_code/telegram/telegram-clone-backend
npm test -- tests/recommendation/schedulerOwnership.test.ts
```

Expected: PASS.

Implementation status:
- `buildRecommendationSchedulePlan()` now makes `daily-recommendation-refresh` the only default recommendation owner.
- Standalone SimClusters and RealGraph repair cron jobs register only when `RECOMMENDATION_REPAIR_JOBS_ENABLED=true`; CLI/manual invocation remains available through the existing job classes.
- `SimClustersBatchJob` and `RealGraphDecayJob` now persist `RecommendationJobRun` evidence with `mode: 'repair'`, repair job names, counts, duration, status, and trigger.
- Verification passed with `npm test -- tests/recommendation/schedulerOwnership.test.ts` and the Task 3/4 combined backend graph-kernel/scheduler test set.

---

### Task 5: Feature And Embedding Provenance Hardening

**Files:**
- Modify: `telegram-clone-backend/src/services/recommendation/contentFeatures/PostFeatureSnapshotService.ts`
- Modify: `telegram-clone-backend/src/services/recommendation/contracts/embeddingContract.ts`
- Modify: `telegram-clone-backend/src/services/recommendation/sources/TwoTowerSource.ts`
- Modify: `telegram-clone-backend/src/services/recommendation/sources/NewsAnnSource.ts`
- Modify: `telegram-clone-backend/src/services/newsService.ts`
- Test: `telegram-clone-backend/tests/recommendation/embeddingProvenance.test.ts`

- [x] **Step 1: Write provenance test**

Create `telegram-clone-backend/tests/recommendation/embeddingProvenance.test.ts`:

```ts
import { buildDensePostEmbedding } from '../../src/services/recommendation/contentFeatures/denseEmbedding';
import { assertEmbeddingContractCompatible } from '../../src/services/recommendation/contracts/embeddingContract';

describe('embedding provenance', () => {
  it('marks heuristic embeddings as non-semantic and blocks semantic ANN use', () => {
    const embedding = buildDensePostEmbedding({ title: 'market rally', content: 'stocks rise' } as any);
    const contract = {
      embeddingSpace: 'crawler_tfidf_v0',
      modelVersion: 'heuristic_fallback',
      artifactVersion: 'local_hash_v1',
      dimensions: embedding.length,
      semantic: false,
    };

    expect(() =>
      assertEmbeddingContractCompatible(contract, {
        embeddingSpace: 'semantic_news_v1',
        dimensions: embedding.length,
        semantic: true,
      }),
    ).toThrow(/embedding_contract_mismatch/);
  });
});
```

- [x] **Step 2: Add semantic flag to embedding contract**

In `embeddingContract.ts`, add:

```ts
export interface EmbeddingContract {
  embeddingSpace: string;
  dimensions: number;
  modelVersion: string;
  artifactVersion: string;
  semantic: boolean;
}
```

Update compatibility checks to reject `semantic: false` when a source requires semantic ANN behavior.

- [x] **Step 3: Mark crawler and hash embeddings explicitly**

In `PostFeatureSnapshotService.ts`, write heuristic embeddings as:

```ts
embeddingContract: {
  embeddingSpace: 'heuristic_post_hash_v1',
  dimensions: denseEmbedding.length,
  modelVersion: 'heuristic_fallback',
  artifactVersion: 'local_hash_v1',
  semantic: false,
},
```

In `newsService.ts`, mark crawler TF-IDF/KMeans vectors as `crawler_tfidf_v0` and do not allow them to satisfy semantic ANN source requirements.

- [x] **Step 4: Gate TwoTower and NewsAnn source usage**

In `TwoTowerSource.ts` and `NewsAnnSource.ts`, before using a vector for ANN-like retrieval, call the compatibility helper:

```ts
if (!isEmbeddingContractCompatible(snapshot.embeddingContract, requiredContract)) {
  return this.fallbackToKeywordOrRecentCandidates(query);
}
```

Use the existing fallback paths rather than throwing in the serving path.

- [x] **Step 5: Run verification**

Run:

```bash
cd /Users/achilles/Documents/telegram_code/telegram/telegram-clone-backend
npm test -- tests/recommendation/embeddingProvenance.test.ts
npm run audit:embedding-contracts -- --limit 5000
```

Expected: PASS, audit reports no incompatible production samples for sources currently enabled by default.

Implementation status:
- `EmbeddingContract` now carries semantic provenance while preserving the existing `retrievalEmbeddingDim`/`rankingEmbeddingDim` fields and supporting `dimensions` for compatibility with the plan contract shape.
- `PostFeatureSnapshotService` writes local feature-hash dense embeddings as `heuristic_post_hash_v1`, `heuristic_fallback`, `local_hash_v1`, `semantic:false`.
- `newsService` treats unprovenanced external ingest embeddings as crawler/heuristic vectors and drops them from storage unless a complete semantic contract is supplied, avoiding silent promotion of crawler vectors into ANN-like paths.
- `TwoTowerSource` gates remote ANN retrieval on a compatible semantic user embedding contract, then falls back to existing keyword candidates when incompatible.
- `NewsAnnSource` gates ANN retrieval on an explicit semantic news ANN runtime contract; default runtime uses `crawler_tfidf_v0` and falls back to recent news.
- `embeddingContext` serialization now preserves optional `embeddingContract`, and the local logger falls back to JSON when `pino-pretty` is absent so audit scripts run in the default environment.
- Verification passed with `npm test -- tests/recommendation/embeddingProvenance.test.ts`, the related embedding/news test set, `npx tsc --noEmit`, and `npm run audit:embedding-contracts -- --limit 5000` reporting zero incompatible sampled user/post embeddings.

---

### Task 6: Replay And Logging Readiness Metrics

> Implementation status (2026-07-06): Completed. Node replay evaluation now reports request-level logging readiness counters independently from ranking metrics. Rust replay output carries the same `loggingReadiness` payload with legacy-deserialization defaults; current Rust fixture candidates intentionally surface `requestsMissingRank` because the Rust candidate payload has no served-rank field. The actual sample export files are `exportRecsysTrainingSamples.ts` and `exportRecsysReplayRequests.ts`; both now export readiness join fields, and feed action/trace persistence now preserves `secondaryRecallSources` when available.

**Files:**
- Modify: `telegram-clone-backend/src/services/recommendation/replay/evaluator.ts`
- Modify: `telegram-rust-workspace/crates/telegram-rust-recommendation/src/replay/evaluator.rs`
- Modify: `telegram-clone-backend/src/scripts/exportRecsysTrainingSamples.ts`
- Modify: `telegram-clone-backend/src/scripts/exportRecsysReplayRequests.ts`
- Test: `telegram-clone-backend/tests/recommendation/replayLoggingReadiness.test.ts`
- Test: `telegram-rust-workspace/crates/telegram-rust-recommendation/src/replay/tests.rs`

- [x] **Step 1: Write replay readiness test**

Create `telegram-clone-backend/tests/recommendation/replayLoggingReadiness.test.ts`:

```ts
import { evaluateReplayRequests } from '../../src/services/recommendation/replay/evaluator';

describe('replay logging readiness', () => {
  it('reports missing source, rank, and experiment fields separately from ranking quality', () => {
    const result = evaluateReplayRequests([
      {
        requestId: 'req_1',
        served: [{ postId: 'post_1', rank: 1, recallSource: 'GraphSource', score: 0.7 }],
        feedback: [{ postId: 'post_1', eventType: 'click' }],
      },
      {
        requestId: 'req_2',
        served: [{ postId: 'post_2' }],
        feedback: [],
      },
    ] as any);

    expect(result.loggingReadiness.requestsMissingRank).toBe(1);
    expect(result.loggingReadiness.requestsMissingRecallSource).toBe(1);
  });
});
```

- [x] **Step 2: Add logging readiness counters**

In Node replay evaluator, add:

```ts
export interface LoggingReadinessSummary {
  totalRequests: number;
  requestsMissingRank: number;
  requestsMissingRecallSource: number;
  requestsMissingScore: number;
  requestsMissingExperimentKeys: number;
  requestsMissingFeedbackJoinKey: number;
}
```

Populate it independently from `ndcg`, `mrr`, and ranking quality metrics.

- [x] **Step 3: Align Rust replay output**

In Rust replay evaluator, add equivalent fields:

```rust
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LoggingReadinessSummary {
    pub total_requests: usize,
    pub requests_missing_rank: usize,
    pub requests_missing_recall_source: usize,
    pub requests_missing_score: usize,
    pub requests_missing_experiment_keys: usize,
    pub requests_missing_feedback_join_key: usize,
}
```

Include it in `ReplayEvaluationResult`.

- [x] **Step 4: Export readiness in training samples**

In the actual export scripts (`exportRecsysTrainingSamples.ts` and `exportRecsysReplayRequests.ts`), include these fields per sample:

```ts
{
  requestId,
  postId,
  rank,
  score,
  weightedScore,
  recallSource,
  secondaryRecallSources,
  selectionPool,
  selectionReason,
  experimentKeys,
  productSurface,
  modelPostId,
  feedbackLabel,
}
```

- [x] **Step 5: Run verification**

Run:

```bash
cd /Users/achilles/Documents/telegram_code/telegram/telegram-clone-backend
npm test -- tests/recommendation/replayLoggingReadiness.test.ts
cd /Users/achilles/Documents/telegram_code/telegram/telegram-rust-workspace
cargo test -p telegram-rust-recommendation replay
```

Expected: PASS.

Verification passed with:
- `rtk npm test -- tests/recommendation/replayLoggingReadiness.test.ts tests/recommendation/replayEvaluator.test.ts tests/recommendation/feedActionLogging.test.ts tests/recommendation/recommendationTraceLogger.test.ts`
- `rtk npx tsc --noEmit --target ES2020 --module commonjs --strict --esModuleInterop --skipLibCheck --resolveJsonModule src/scripts/exportRecsysTrainingSamples.ts src/scripts/exportRecsysReplayRequests.ts`
- `rtk npx tsc --noEmit`
- `rtk cargo test -p telegram-rust-recommendation replay`

---

### Task 7: Rollout Gates And Industrialization Checklist

> Implementation status (2026-07-06): Completed. Recommendation ops readiness now exposes rollout blocker keys for Rust primary fallback rate, graph kernel diagnostics coverage, replay logging readiness, and embedding contract incompatibility. The release contract env records the gate thresholds, `verify_all.sh` includes the recommendation ops/audit/Rust replay checks, and the industrialization checklist documents promotion gates and delayed algorithm work.
> Follow-up verification update (2026-07-06): `tools/release/verify_fast.sh` now defaults to the existing CMake preset output at `telegram-cpp-graph-service/build/release` and configures the release preset when the build cache is missing.

**Files:**
- Create: `telegram-clone-backend/docs/recommendation/industrialization-checklist.md`
- Modify: `telegram-clone-backend/src/services/ops/recommendation/buildRecommendationOps.ts`
- Modify: `deploy/vps/recommendation_runtime_contract.env`
- Modify: `tools/release/verify_all.sh`
- Test: `telegram-clone-backend/tests/ops/recommendationOpsReadiness.test.ts`

- [x] **Step 1: Write ops readiness test**

Create `telegram-clone-backend/tests/ops/recommendationOpsReadiness.test.ts`:

```ts
import { buildRecommendationOpsSummary } from '../../src/services/ops/recommendation/buildRecommendationOps';

describe('recommendation ops readiness', () => {
  it('surfaces rollout blockers for Rust primary and graph kernel diagnostics', async () => {
    const summary = await buildRecommendationOpsSummary({
      rustPrimaryFallbackRate: 0.12,
      graphKernelMissingDiagnosticsRate: 0.05,
      replayLoggingReadiness: { requestsMissingRank: 0, requestsMissingRecallSource: 2 },
    } as any);

    expect(summary.blockers).toContain('rust_primary_fallback_rate_high');
    expect(summary.blockers).toContain('graph_kernel_diagnostics_missing');
    expect(summary.blockers).toContain('replay_logging_readiness_incomplete');
  });
});
```

- [x] **Step 2: Add checklist document**

Create `telegram-clone-backend/docs/recommendation/industrialization-checklist.md`:

```md
# Recommendation Industrialization Checklist

## Rollout Gates

- Rust primary fallback rate is below 1% for 24 hours.
- Graph kernel diagnostics are present on at least 99% of graph source requests.
- Replay logging readiness has zero missing rank, requestId, recallSource, and postId fields on sampled requests.
- News feed events bridge to recommendation events for impression, click, dwell, like, dismiss, report, block, and mute.
- Embedding contract audit reports zero enabled-source incompatibilities.
- Daily recommendation refresh is the only default scheduled RealGraph/SimClusters owner.

## Delayed Algorithm Work

- Full SimClusters training starts only after event and feature contracts are stable.
- TwHIN starts only after entity/relation schema and offline samples are versioned.
- GNN retrieval starts only after LightGCN or sparse community vectors beat simple baselines in replay.
- Online learning starts only after propensity/randomized exploration logs exist.
```

- [x] **Step 3: Extend ops summary blockers**

In `buildRecommendationOps.ts`, add blocker keys:

```ts
const blockers = [
  rustPrimaryFallbackRate > 0.01 ? 'rust_primary_fallback_rate_high' : null,
  graphKernelMissingDiagnosticsRate > 0.01 ? 'graph_kernel_diagnostics_missing' : null,
  replayLoggingReadinessIncomplete ? 'replay_logging_readiness_incomplete' : null,
  embeddingContractIncompatibleCount > 0 ? 'embedding_contract_incompatible' : null,
].filter(Boolean);
```

- [x] **Step 4: Gate release verification**

In `tools/release/verify_all.sh`, include the existing recommendation checks plus:

```bash
npm --prefix telegram-clone-backend run test -- tests/ops/recommendationOpsReadiness.test.ts
npm --prefix telegram-clone-backend run audit:embedding-contracts -- --limit 5000
cargo test --manifest-path telegram-rust-workspace/Cargo.toml -p telegram-rust-recommendation replay
```

- [x] **Step 5: Run verification**

Run:

```bash
cd /Users/achilles/Documents/telegram_code/telegram
tools/release/verify_fast.sh
```

Expected: PASS or a concrete blocker name from the new checklist.

Verification passed with:
- `rtk npm test -- tests/ops/recommendationOpsReadiness.test.ts tests/ops/recommendationOpsRoute.test.ts`
- `rtk npm test -- tests/recommendation/replayLoggingReadiness.test.ts tests/recommendation/replayEvaluator.test.ts tests/recommendation/feedActionLogging.test.ts tests/recommendation/recommendationTraceLogger.test.ts tests/ops/recommendationOpsReadiness.test.ts tests/ops/recommendationOpsRoute.test.ts`
- `rtk npx tsc --noEmit`
- `rtk bash -n tools/release/verify_all.sh`
- `rtk bash tools/release/verify_fast.sh`
- `rtk npm --prefix telegram-clone-backend run audit:embedding-contracts -- --limit 5000`
- `rtk cargo test --manifest-path telegram-rust-workspace/Cargo.toml -p telegram-rust-recommendation replay`

---

## Integration Order

1. Task 1 first: stable context is the join key for everything else.
2. Task 2 second: event idempotency and news bridging prevent corrupted training/replay data.
3. Task 3 third: graph kernel diagnostics and snapshot consistency protect the highest-risk cross-language path.
4. Task 4 fourth: remove duplicate default jobs before relying on versioned graph/community vectors.
5. Task 5 fifth: feature and embedding provenance prevents false model-quality conclusions.
6. Task 6 sixth: replay readiness makes offline iteration meaningful.
7. Task 7 last: rollout gates make the work enforceable in release flow.

---

## Deferred Work

These are intentionally not first-phase tasks:

- Full learned RealGraph classifier. Current heuristic RealGraph is acceptable as a feature if clearly labeled.
- Full Twitter-scale SimClusters. Use simplified sparse community vectors first.
- TwHIN heterogeneous graph embeddings. Start after event/entity/relation schemas are versioned.
- PinSage/GraphSAGE production GNN. Start only after simple graph and ANN baselines are measured.
- Online learning. Start only after randomized exposure, propensity, and guardrail metrics exist.
- Slate RL or long-term reward optimization. Start only after stable online metrics and replay/OPE discipline exist.

---

## Self-Review

- Spec coverage: The plan covers local algorithm code feasibility, external industrial and paper research, multi-agent findings, and a concrete Superpowers implementation workflow.
- Placeholder scan: No task uses `TBD`, `TODO`, or unspecified "add tests" instructions. Each task includes files, concrete tests, implementation shape, and verification commands.
- Type consistency: `RecommendationContext`, `GraphKernelDiagnostics`, `EmbeddingContract`, and `LoggingReadinessSummary` are named consistently across tasks.
