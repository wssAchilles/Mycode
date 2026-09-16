# Recommendation Embedding Contract Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户与帖子向量的生产者契约真实、可审计、不可被稀疏写入误覆盖，并在任何生产数据变更前形成完整只读证据与独立授权包。

**Architecture:** 保留现有 `EmbeddingContract` 值类型，为用户的 Two-Tower 与 Phoenix 向量增加独立 sidecar，并由一个纯证据分类模块统一 writer、consumer、audit 与 ops 的判断。现有 audit/backfill 入口原地收敛为 fail-closed 工具，不引入第二套迁移框架。

**Tech Stack:** TypeScript、Node.js、Mongoose、Sequelize、MongoDB、Redis、Vitest、现有 release shell scripts。Python 仅作为只读外部依赖，不修改、不测试。

## Global Constraints

- 每个任务开始前并行派出 code verifier、research verifier、plan/scope verifier。
- 所有后续 code verifier、research verifier、plan/scope verifier、implementer、spec reviewer、quality reviewer、fixer 和 final reviewer 的每次调度都必须显式设置 `model=gpt-5.6-sol` 与 `reasoning_effort=ultra`。
- 上述模型约束覆盖 Superpowers `subagent-driven-development` 的默认 Model Selection；不得继承、不得省略、不得降级。调度器若不能同时显式设置这两个值，必须 fail-closed，禁止调度并禁止推进 Task。
- 每次调度证据必须记录实际 agent id、实际 model 和实际 reasoning effort；任一记录缺失或不等于 `gpt-5.6-sol` / `ultra` 时，该 verifier、实现或审查结果无效。
- Research verifier 使用 `agent-reach`，核对工业实践与论文结论，区分直接证据、类比证据和本项目策略。
- 主线程在 verifier 运行期间继续做只读代码图谱、调用链和测试基线检查。
- 每个实现任务使用新的 implementer agent，并严格执行 RED、验证 RED、最小 GREEN、验证 GREEN。
- 实现后依次进行规格符合性审查和代码质量审查；任何重要问题未关闭前不得进入下一任务。
- 共享工作树中的既有改动视为其他工作者所有；implementer 只改任务列出的文件，不撤销、不覆盖无关改动，先检查当前 diff 再编辑。
- 不修改、格式化、生成或测试 `ml-services/**`。
- Task 9 的 Mongo、Redis、scheduler 和进程操作需要单独、明确的生产授权；完成代码和 dry-run 不等于获得该授权。
- Task 4-7 不运行 live audit、`tools/release/verify_all.sh` 或任何生产命令；Task 8 只生成 code-and-dry-run authorization packet。Post-apply strict、cache/process refresh 与 `verify_all.sh` 只属于仍未授权的 Task 9。
- Strict/full 扫描不得有默认或显式静默上限。Limited/sampled mode 只能标为 diagnostic，不能成为 strict、dry-run authorization 或 release 通过证据。

---

## Research Guardrails

- 每向量独立契约参考 named-vector 系统的独立维度和距离配置，但不宣称当前项目等同于任何特定向量数据库实现。
- Lineage 判断遵循 W3C PROV 与 ML Metadata 的原则：维度和标签不能替代生产者证据。
- 确定性 replay 只能证明与当前实现和完整输入一致，不能证明历史生产过程。
- Mongo `_id` 游标只提供稳定顺序，不提供时间点快照；权威 apply 证据必须在 writer pause 或 snapshot read concern 下生成。
- Dry-run/apply 采用 Terraform saved-plan 类似的摘要绑定思想：apply 必须绑定已审阅的完整 proposal digest。
- 跨代 embedding 兼容需要专门训练，本阶段不得通过 metadata 重标宣称兼容。

## Scope

主要修改范围：

- 向量契约与证据分类边界。
- 用户向量 writer、cold-start、repair 与缓存一致性边界。
- Serving、export、ANN 与相似度消费边界。
- Audit、daily ops、dry-run/apply、rollback 与 release gate。
- 对应的少量高价值测试和协调文档。

本阶段不扩展 Rust、frontend、Go、C++ 或 Python 的向量 sidecar 契约。

## Progress Snapshot

- [x] Task 1：Known Contracts And Evidence Classification 已完成并冻结现有验收状态。
- [x] Task 2：Writer Boundary And Sparse-Update Protection 已完成并冻结现有验收状态。
- [x] Task 3：Non-Destructive Cold-Start Creation And Repair 已完成并冻结现有验收状态。
- [x] Task 4：Serving, Export And Similarity Boundaries 已完成并通过 task review。
- [x] Task 5-7：本地 audit、repair、release-gate 实现已完成并通过 task review。
- [x] Task 8：authorization packet 已于 2026-07-14 生成（`reports/recommendation/embedding-contract-remediation/`，状态 `CODE_AND_DRY_RUN_READY` / `NOT GRANTED`）。当前 worktree 存在 README 等漂移，operator 处理后方可刷新确定性检查。
- [ ] Task 9：仅在独立生产授权后执行，当前不属于已授权工作。

## Task 1: Known Contracts And Evidence Classification

**Status:** Complete. 保留现有实现与审查结论；除非 Task 4-8 的回归证据证明契约被破坏，不重新调度本任务。

修改方向：

- 建立已知本地契约、每向量 sidecar 与统一的五态证据分类。
- 缺少权威 semantic manifest 时保持 `semantic_ready` 不可达，默认 sentinel 不得被提升。
- 对未知 lineage、非法结构和不受支持的 quarantine 证据一律 fail-closed。
- 形成可跨 audit、ops 与 repair 复用的确定性 checksum 和 digest 语义。

验收：

- 默认 sentinel 单独存在时不能产生 semantic-ready。
- 冷启动契约与默认语义契约不兼容。
- NaN、Infinity、非数字和错误维度均为 invalid。
- quarantine 身份或向量变化会改变 digest。

## Task 2: Writer Boundary And Sparse-Update Protection

**Status:** Complete. 保留现有实现与审查结论；后续任务只消费其 writer 边界。

修改方向：

- 明确 sparse 与 dense writer 的字段所有权，禁止稀疏写入隐式改写向量契约。
- Dense write 必须携带结构一致的对应 sidecar；legacy shared contract 只读兼容。
- 写入成功后维护现有 embedding 缓存的一致性。
- Demo writer 遵守同一非语义契约边界。

验收：

- Sparse update 的写集合不含任何 dense 或 contract 字段。
- 错误维度、非有限值、缺少 sidecar 的 dense write 被拒绝。
- 两套 cache invalidation 都被验证。
- Demo Two-Tower/Phoenix 向量各自携带正确非语义契约。

## Task 3: Non-Destructive Cold-Start Creation And Repair

**Status:** Complete. 保留现有实现与审查结论；后续任务不得重新解释 unknown 或 quarantined lineage。

修改方向：

- 复用确定性 cold-start 语义，并为新记录写入独立的非语义 sidecar。
- Repair 只处理缺失或已被可信证据标记为本地 cold-start 的损坏槽位。
- 不根据维度、版本标签或 legacy contract 推断生产者。
- Mixed-lineage 与未知 lineage 的已有向量保持非破坏性处理。
- 旧迁移与补齐路径不得重新引入 shared legacy contract。

验收：

- 相同用户输入 replay 完全一致。
- 新用户拥有两组非语义 sidecar。
- Repair 不覆盖未知或 quarantined 的非空向量。
- 两个向量槽位独立修复；修复一个槽位不会改变另一个非空 unknown、quarantined 或 mixed-lineage 槽位。
- Daily refresh 回归路径保持可用。

## Task 4: Serving, Export And Similarity Boundaries

**Files:**

- Modify: `telegram-clone-backend/src/services/jobs/FeatureExportJob.ts`
- Modify: `telegram-clone-backend/src/services/recommendation/hydrators/UserEmbeddingQueryHydrator.ts`
- Modify: `telegram-clone-backend/src/services/recommendation/contentFeatures/denseEmbedding.ts`
- Inspect only: `telegram-clone-backend/src/services/recommendation/sources/TwoTowerSource.ts`
- Inspect only: `telegram-clone-backend/src/services/recommendation/sources/NewsAnnSource.ts`
- Test: `telegram-clone-backend/tests/recommendation/userEmbeddingQueryHydrator.test.ts`
- Test: `telegram-clone-backend/tests/recommendation/embeddingProvenance.test.ts`
- Test: `telegram-clone-backend/tests/recommendation/newsAnnSource.test.ts`
- Test: `telegram-clone-backend/tests/recommendation/denseEmbedding.test.ts`
- Test: `telegram-clone-backend/tests/recommendation/embeddingRetrievalPolicy.test.ts`

**Interfaces:**

- Consumes: existing `classifyEmbeddingContractEvidence(...)` is the single producer-evidence status boundary. Task 4 must not add a second classifier or infer lineage from dimension, `semantic`, model labels, or the legacy shared contract.
- Produces: user Two-Tower ANN hydration and user export accept only `semantic_ready`; all other statuses withhold the query-facing contract and exclude the vector from export.
- `semantic_ready` remains in the status vocabulary but is unreachable in Phase 0.5 from all existing persisted metadata. `DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT` is not an authoritative runtime/corpus manifest. Do not add a positive `semantic_ready` fixture or promote ANN; positive promotion is deferred until a later phase has an authoritative runtime/corpus manifest.
- User producer evidence and the target ANN runtime/corpus contract are independent logical-AND gates. Passing neither gate may be inferred from the other.
- News ANN retains its own history and runtime/corpus contract path. It must not inherit the user Two-Tower evidence gate.
- `cosineDenseEmbedding(left, right)` returns `0` when lengths differ. `computeEmbeddingRecallSignalsFromSnapshot(...)` must expose `denseVectorScore === 0` for the same mismatch. Neither function creates producer evidence, changes `query.embeddingContext.embeddingContract`, or changes ANN/export eligibility; no new compatibility field or status is introduced.

**Acceptance Matrix:**

| Case | Evidence expectation | User Two-Tower ANN | User export | Required proof |
| --- | --- | --- | --- | --- |
| Default legacy sentinel | `unclassified` | Not called | Excluded | Hydrator and provenance tests |
| Registered-user cold-start | `verified_local_fallback` | Not called | Excluded | Hydrator and export tests |
| Approved quarantine | `quarantined` | Not called | Excluded | Hydrator and export tests |
| Unknown lineage | `unclassified` | Not called | Excluded | Hydrator and export tests |
| `semantic_ready` | Vocabulary retained but unreachable from existing persisted metadata in Phase 0.5 | No positive path in this phase | No positive fixture in this phase | Existing classifier contract plus negative consumer matrix |
| Target runtime/corpus mismatch | Producer evidence cannot bypass this independent gate | Not called | Producer gate remains independently enforced | Provenance test with mismatched target contract |
| News ANN | Governed only by News history and its own runtime/corpus contract | User gate has no effect | Not applicable | Existing `newsAnnSource.test.ts` enables the News contract and observes News ANN invocation |
| Mismatched dimensions | Structural incompatibility | Existing negative consumer gate remains unchanged | Existing negative export gate remains unchanged | Helper and snapshot-policy path both return zero while query contract remains unchanged |

- [ ] **RED Step 1: Add the exact persisted-state negative tests**

  In `userEmbeddingQueryHydrator.test.ts`, retain the existing imports and add this exact table test if it is not already present:

  ```ts
  it.each([
    {
      name: 'legacy default sentinel',
      dense: {
        twoTowerEmbedding: new Array(DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.retrievalEmbeddingDim).fill(0),
        embeddingContract: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
      },
    },
    {
      name: 'verified cold-start fallback',
      dense: {
        twoTowerEmbedding: new Array(REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT.retrievalEmbeddingDim).fill(0),
        twoTowerEmbeddingContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
      },
    },
    {
      name: 'quarantined legacy vector',
      dense: {
        twoTowerEmbedding: new Array(DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.retrievalEmbeddingDim).fill(0),
        twoTowerEmbeddingQuarantineReason: LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
      },
    },
    {
      name: 'unknown semantic producer',
      dense: {
        twoTowerEmbedding: new Array(DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.retrievalEmbeddingDim).fill(0),
        twoTowerEmbeddingContract: {
          ...DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
          producer: 'unverified-external-producer',
        },
      },
    },
  ])('keeps sparse context usable but withholds ANN contract for $name', async ({ dense }) => {
    vi.spyOn(FeatureStore, 'getUserEmbedding').mockResolvedValue({
      interestedInClusters: [{ clusterId: 101, score: 0.7 }],
      producerEmbedding: [{ clusterId: 101, score: 0.5 }],
      qualityScore: 0.8,
      computedAt: new Date().toISOString(),
      version: 3,
      ...dense,
    } as any);

    const hydrated = await new UserEmbeddingQueryHydrator()
      .hydrate(createFeedQuery('viewer-evidence', 20));

    expect(hydrated.embeddingContext?.usable).toBe(true);
    expect(hydrated.embeddingContext?.embeddingContract).toBeUndefined();
  });
  ```

  In `embeddingProvenance.test.ts`, import `REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT` and `LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON`, then use this complete export test:

  ```ts
  it('excludes every non-semantic-ready persisted user cohort from ANN export', async () => {
    const defaultVector = new Array(
      DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT.retrievalEmbeddingDim,
    ).fill(0);
    const coldStartVector = new Array(
      REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT.retrievalEmbeddingDim,
    ).fill(0);
    const rows = [
      {
        userId: 'legacy-shared',
        twoTowerEmbedding: defaultVector,
        embeddingContract: DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
        qualityScore: 0.9,
      },
      {
        userId: 'cold-start',
        twoTowerEmbedding: coldStartVector,
        twoTowerEmbeddingContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
        qualityScore: 0.9,
      },
      {
        userId: 'quarantined',
        twoTowerEmbedding: defaultVector,
        twoTowerEmbeddingQuarantineReason: LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON,
        qualityScore: 0.9,
      },
      {
        userId: 'unknown-producer',
        twoTowerEmbedding: defaultVector,
        twoTowerEmbeddingContract: {
          ...DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
          producer: 'unverified-external-producer',
        },
        qualityScore: 0.9,
      },
    ];
    let batch = 0;
    vi.spyOn(UserFeatureVector as any, 'find').mockImplementation(() => {
      const result = batch === 0 ? rows : [];
      batch += 1;
      const query = {
        select: vi.fn(),
        skip: vi.fn(),
        limit: vi.fn().mockResolvedValue(result),
      } as any;
      query.select.mockReturnValue(query);
      query.skip.mockReturnValue(query);
      return query;
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const outputDir = await mkdtemp(join(tmpdir(), 'feature-export-evidence-'));

    try {
      const result = await new FeatureExportJob().run({ onlyUsers: true, outputDir });
      const exported = JSON.parse(
        await readFile(join(outputDir, 'user_embeddings.json'), 'utf8'),
      );
      expect(result.usersExported).toBe(0);
      expect(exported).toEqual([]);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
  ```

- [ ] **RED Step 2: Add the synthetic Two-Tower runtime requirement test**

  Add this complete test to `embeddingProvenance.test.ts`. It bypasses persisted-state classification on purpose and directly drives the existing source-level runtime contract guard:

  ```ts
  it('rejects a synthetic query contract that mismatches the TwoTower runtime requirement', async () => {
    const query = createFeedQuery('viewer-runtime-mismatch', 20);
    query.embeddingContext = {
      interestedInClusters: [],
      producerEmbedding: [],
      qualityScore: 1,
      usable: false,
      stale: false,
      embeddingContract: {
        ...DEFAULT_RECOMMENDATION_EMBEDDING_CONTRACT,
        embeddingSpace: 'synthetic_source_level_mismatch',
      },
    } as any;
    query.experimentContext = {
      getConfig: (_experimentId: string, key: string, defaultValue: unknown) =>
        key === 'enable_embedding_retrieval' ? false : defaultValue,
    } as any;
    const post = {
      _id: oid('507f191e810c19729de8b011'),
      authorId: 'author-runtime-mismatch',
      content: 'runtime contract fallback',
      keywords: ['runtime'],
      createdAt: new Date('2026-03-03T00:00:00.000Z'),
      isReply: false,
      isRepost: false,
      isNews: false,
      stats: { likeCount: 10, commentCount: 1, repostCount: 0, viewCount: 100 },
      media: [],
      isNsfw: false,
      isPinned: false,
    };
    const annClient = { retrieve: vi.fn().mockResolvedValue([]) };
    const source = new TwoTowerSource(annClient as any);
    vi.spyOn(source as any, 'loadCandidatePools').mockResolvedValue([
      { entries: [{ post }], poolKind: 'legacy_pool', priorityScore: 0 },
    ]);

    const out = await source.getCandidates(query as any);

    expect(annClient.retrieve).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0].interestPoolKind).toBe('keyword_fallback');
    expect(query.embeddingContext.embeddingContract?.embeddingSpace)
      .toBe('synthetic_source_level_mismatch');
  });
  ```

  This synthetic test proves only that `TwoTowerSource` enforces its current source runtime requirement. It does not prove that a live runtime/corpus manifest exists, does not make persisted `semantic_ready` reachable, and does not authorize ANN promotion.

- [ ] **RED Step 3: Add the independent News ANN positive contract test**

  In the existing `newsAnnSource.test.ts`, keep its current imports and add this complete test:

  ```ts
  it('uses the independent News runtime contract without a user embedding contract', async () => {
    vi.stubEnv('NEWS_ANN_SEMANTIC_CONTRACT_ENABLED', 'true');
    const query = createFeedQuery('news-viewer', 20);
    query.newsHistoryExternalIds = ['N0'];
    expect(query.embeddingContext).toBeUndefined();
    const annClient = {
      retrieve: vi.fn().mockResolvedValue([{ postId: 'N2', score: 0.9 }]),
    };
    const post = {
      _id: oid('507f191e810c19729de8a012'),
      authorId: 'news_bot_official',
      content: 'independent news ann',
      createdAt: new Date('2026-03-04T00:00:00.000Z'),
      isReply: false,
      isRepost: false,
      isNews: true,
      newsMetadata: { externalId: 'N2', source: 'mind', url: 'mind://N2' },
      stats: { likeCount: 0, commentCount: 0, repostCount: 0, viewCount: 0 },
      media: [],
      isNsfw: false,
      isPinned: false,
    };
    const mockLean = vi.fn().mockResolvedValue([post]);
    vi.spyOn(Post as any, 'find').mockReturnValue({ lean: mockLean } as any);

    const out = await new NewsAnnSource(annClient as any).getCandidates(query as any);

    expect(annClient.retrieve).toHaveBeenCalledOnce();
    expect(out).toHaveLength(1);
    expect(out[0].newsMetadata?.externalId).toBe('N2');
    expect(out[0]._scoreBreakdown).toMatchObject({
      annRetrievalScore: 0.9,
      annRetrievalRank: 1,
    });
  });
  ```

- [ ] **RED Step 4: Add exact unequal-dimension helper and policy tests**

  Add this complete helper test to `denseEmbedding.test.ts`:

  ```ts
  it('returns zero instead of comparing unequal vector prefixes', () => {
    expect(cosineDenseEmbedding([1, 0], [1])).toBe(0);
    expect(cosineDenseEmbedding([1], [1, 0])).toBe(0);
  });
  ```

  Add `computeEmbeddingRecallSignalsFromSnapshot` to the existing imports in `embeddingRetrievalPolicy.test.ts`, then add:

  ```ts
  it('keeps producer and eligibility boundaries unchanged for unequal dense dimensions', () => {
    const query = createFeedQuery('viewer-dimension-mismatch', 20);
    query.embeddingContext = {
      interestedInClusters: [{ clusterId: 7, score: 0.9 }],
      producerEmbedding: [],
      qualityScore: 0.8,
      usable: true,
      stale: false,
    } as any;
    const contractBefore = query.embeddingContext.embeddingContract;
    const context: PreparedEmbeddingRetrievalContext = {
      qualityScore: 0.8,
      userClusters: [{ clusterId: 7, score: 0.9 }],
      userClusterMap: new Map([[7, 0.9]]),
      keywordWeights: new Map(),
      denseUserEmbedding: [1, 0],
    };

    const signals = computeEmbeddingRecallSignalsFromSnapshot(
      { denseEmbedding: [1] },
      context,
    );

    expect(signals.denseVectorScore).toBe(0);
    expect(query.embeddingContext.embeddingContract).toBe(contractBefore);
    expect(query.embeddingContext.embeddingContract).toBeUndefined();
  });
  ```

  The policy function returns only `EmbeddingRecallSignals`; it does not receive persisted evidence and cannot grant ANN/export eligibility. The Two-Tower and export tests above are the required proof that a numeric zero leaves those gates closed.

- [ ] **RED Step 5: Run the focused Task 4 tests and record the expected failure**

  Run:

  ```bash
  (cd telegram-clone-backend && ./node_modules/.bin/vitest run tests/recommendation/userEmbeddingQueryHydrator.test.ts tests/recommendation/embeddingProvenance.test.ts tests/recommendation/newsAnnSource.test.ts tests/recommendation/denseEmbedding.test.ts tests/recommendation/embeddingRetrievalPolicy.test.ts)
  ```

  Expected: nonzero. The current working tree has a known syntax gap in `FeatureExportJob.ts`: the `evidence === 'semantic_ready'` condition is missing the following `&&`. This parse/compile failure is a GREEN prerequisite and must not be reported as already fixed.

- [ ] **RED Step 6: Repair only the known syntax gap, then expose behavioral RED**

  Apply this exact syntax-only correction in `FeatureExportJob.ts`, rerun the Step 5 command, and record the remaining unequal-dimension failure:

  ```ts
  if (
      evidence === 'semantic_ready'
      && user.twoTowerEmbedding
      && user.twoTowerEmbedding.length === CONFIG.userEmbeddingDim
  ) {
  ```

  Expected: tests reach assertions; unequal dimensions still fail before the cosine implementation changes.

- [ ] **GREEN Step 7: Implement the minimum consumer and cosine changes**

  Keep this existing hydrator expression as the complete query-facing producer gate:

  ```ts
  embeddingContract: denseEvidence === 'semantic_ready'
      ? embedding.twoTowerEmbeddingContract
      : undefined,
  ```

  Keep the corrected export condition from Step 6 as the complete export gate. Replace `cosineDenseEmbedding(...)` with:

  ```ts
  export function cosineDenseEmbedding(left?: number[], right?: number[]): number {
      if (!Array.isArray(left)
          || !Array.isArray(right)
          || left.length === 0
          || right.length === 0
          || left.length !== right.length) {
          return 0;
      }

      let dot = 0;
      for (let index = 0; index < left.length; index += 1) {
          dot += (left[index] || 0) * (right[index] || 0);
      }
      return clamp01(dot);
  }
  ```

  Do not modify `TwoTowerSource.ts` or `NewsAnnSource.ts`; the tests exercise their existing independent guards.

- [ ] **GREEN Step 8: Run focused tests**

  Run the Step 5 command again.

  Expected: all five test files pass; default/cold-start/quarantine/unknown users do not call user ANN and are not exported; the synthetic source mismatch does not call Two-Tower ANN; News ANN remains independently callable; helper and snapshot policy return zero for unequal dimensions without changing query contract or eligibility gates.

- [ ] **GREEN Step 9: Run backend type checking**

  Run:

  ```bash
  ./telegram-clone-backend/node_modules/.bin/tsc --noEmit -p telegram-clone-backend/tsconfig.json --pretty false
  ```

  Expected: exit 0. Do not run `tools/release/verify_all.sh` in Task 4.

## Task 5: Shared Audit And Daily-Ops Semantics

**Files:**

- Modify: `telegram-clone-backend/src/config/db.ts`
- Create: `telegram-clone-backend/src/services/ops/recommendation/auditMongoAccess.ts`
- Create: `telegram-clone-backend/src/services/ops/recommendation/embeddingEvidenceAudit.ts`
- Modify: `telegram-clone-backend/src/scripts/auditEmbeddingContracts.ts`
- Modify: `telegram-clone-backend/src/scripts/auditDailyRecommendationRefresh.ts`
- Modify: `telegram-clone-backend/src/services/ops/recommendation/dailyRefreshOps.ts`
- Create: `telegram-clone-backend/tests/recommendation/auditMongoAccess.test.ts`
- Create: `telegram-clone-backend/tests/recommendation/embeddingEvidenceAudit.test.ts`
- Test: `telegram-clone-backend/tests/scripts/auditEmbeddingContracts.test.ts`
- Test: `telegram-clone-backend/tests/recommendation/dailyRefreshOps.test.ts`
- Regression input: `telegram-clone-backend/tests/recommendation/embeddingContractEvidence.test.ts`

**Interfaces:**

- Produce the shared evidence helpers in `embeddingEvidenceAudit.ts` (as implemented): `createEmbeddingEvidenceSummary()`, `accumulateEmbeddingEvidence(...)`, `accumulatePostEmbeddingEvidence(...)`, `isFullEmbeddingEvidenceSummary(...)`, and `scanEmbeddingContractEvidence(options)`. Both `buildEmbeddingContractAudit(...)` and `buildDailyRecommendationRefreshAudit(...)` consume the same classifier vocabulary and report the five statuses from `classifyEmbeddingContractEvidence(...)`: `verified_local_fallback`, `semantic_ready`, `quarantined`, `invalid`, and `unclassified`. (Plan text previously named a single `summarizeEmbeddingEvidence(inputs)` helper; that name is superseded by the create/accumulate/scan API.)
- Strict user/post scans use stable `_id` cursor traversal over the full collection. They report that this is stable ordering, not snapshot isolation; an authoritative apply packet still requires writer pause or an approved snapshot read concern.
- Strict mode has no default or explicit silent cap and rejects any limited invocation. Limited mode is diagnostic-only and cannot emit a passing strict/release result.
- Strict accepts only a quarantine digest supplied from previously reviewed evidence. It must not compute the current digest and treat that same value as approval.
- Post vectors require exact deterministic replay evidence; a replay mismatch is `invalid`.
- Read-only entrypoints require both `RECOMMENDATION_AUDIT_MONGODB_URI` and `RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE`. They never fall back to `MONGODB_URI`.
- `RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE` is operator-reviewed proof input, not a programmatic proof that MongoDB granted the role. The program validates its schema, expiry, exact role string, and URI SHA-256 binding before connection; the operator remains responsible for verifying the server-side role.
- After preflight succeeds, `connectMongoDB(...)` receives the dedicated URI with `autoIndex: false` and `autoCreate: false`.
- CLI exits are fixed: `0` means the complete audit passed; `2` means the complete audit ran and found evidence incompatibility; `3` means credential preflight, connection, parsing, or program failure. Task 8 may record `2` for a pre-apply baseline but must reject `3`.

**Read-Only Evidence JSON Schema:**

```ts
export interface RecommendationAuditReadOnlyEvidence {
    schemaVersion: 1;
    reviewedBy: string;
    reviewedAt: string;
    expiresAt: string;
    mongodbUriSha256: string;
    database: string;
    role: 'read';
}
```

Valid JSON has exactly this shape; `mongodbUriSha256` is lowercase SHA-256 of the exact UTF-8 `RECOMMENDATION_AUDIT_MONGODB_URI` value:

```json
{
  "schemaVersion": 1,
  "reviewedBy": "production-database-operator",
  "reviewedAt": "2026-07-13T00:00:00.000Z",
  "expiresAt": "2026-07-20T00:00:00.000Z",
  "mongodbUriSha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "database": "telegram",
  "role": "read"
}
```

The all-`a` digest is schema illustration only and cannot pass unless it is the real URI digest.

**Pre-Connection Failure Contract:**

| Condition | Error code and message prefix | CLI exit | Connection |
| --- | --- | --- | --- |
| Dedicated URI missing | `recommendation_audit_uri_missing: RECOMMENDATION_AUDIT_MONGODB_URI is required` | `3` | Not called |
| Evidence path missing | `recommendation_audit_evidence_file_missing: RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE is required` | `3` | Not called |
| File unreadable/JSON/schema invalid | `recommendation_audit_evidence_invalid:` | `3` | Not called |
| `role` is not exactly `read` | `recommendation_audit_role_not_allowed: role must equal read` | `3` | Not called |
| Evidence expired | `recommendation_audit_evidence_expired:` | `3` | Not called |
| URI digest mismatch | `recommendation_audit_uri_digest_mismatch:` | `3` | Not called |

- [ ] **RED Step 1: Add the complete read-only connection tests**

  Create `auditMongoAccess.test.ts` with this complete test body:

  ```ts
  import { afterEach, describe, expect, it, vi } from 'vitest';
  import { createHash } from 'node:crypto';
  import { mkdtemp, rm, writeFile } from 'node:fs/promises';
  import { tmpdir } from 'node:os';
  import { join } from 'node:path';

  import { connectRecommendationAuditMongo } from '../../src/services/ops/recommendation/auditMongoAccess';

  const uri = 'mongodb://audit-reader:secret@localhost:27017/telegram';
  const uriSha256 = createHash('sha256').update(uri, 'utf8').digest('hex');
  let workDir: string | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (workDir) await rm(workDir, { recursive: true, force: true });
    workDir = undefined;
  });

  describe('connectRecommendationAuditMongo', () => {
    it('fails before connectMongoDB when the dedicated URI is missing', async () => {
      const connectMongoDB = vi.fn().mockResolvedValue(undefined);

      await expect(connectRecommendationAuditMongo({
        env: {},
        connectMongoDB,
        now: new Date('2026-07-14T00:00:00.000Z'),
      })).rejects.toMatchObject({ code: 'recommendation_audit_uri_missing' });

      expect(connectMongoDB).not.toHaveBeenCalled();
    });

    it('fails before connectMongoDB when the evidence path is missing', async () => {
      const connectMongoDB = vi.fn().mockResolvedValue(undefined);

      await expect(connectRecommendationAuditMongo({
        env: { RECOMMENDATION_AUDIT_MONGODB_URI: uri },
        connectMongoDB,
        now: new Date('2026-07-14T00:00:00.000Z'),
      })).rejects.toMatchObject({ code: 'recommendation_audit_evidence_file_missing' });

      expect(connectMongoDB).not.toHaveBeenCalled();
    });

    it('fails before connectMongoDB when the operator evidence names a write role', async () => {
      workDir = await mkdtemp(join(tmpdir(), 'recommendation-audit-access-'));
      const evidenceFile = join(workDir, 'read-only-evidence.json');
      await writeFile(evidenceFile, JSON.stringify({
        schemaVersion: 1,
        reviewedBy: 'database-operator',
        reviewedAt: '2026-07-13T00:00:00.000Z',
        expiresAt: '2026-07-20T00:00:00.000Z',
        mongodbUriSha256: uriSha256,
        database: 'telegram',
        role: 'readWrite',
      }));
      const connectMongoDB = vi.fn().mockResolvedValue(undefined);

      await expect(connectRecommendationAuditMongo({
        env: {
          RECOMMENDATION_AUDIT_MONGODB_URI: uri,
          RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE: evidenceFile,
        },
        connectMongoDB,
        now: new Date('2026-07-14T00:00:00.000Z'),
      })).rejects.toMatchObject({ code: 'recommendation_audit_role_not_allowed' });

      expect(connectMongoDB).not.toHaveBeenCalled();
    });

    it('connects only after validation and disables Mongoose auto creation', async () => {
      workDir = await mkdtemp(join(tmpdir(), 'recommendation-audit-access-'));
      const evidenceFile = join(workDir, 'read-only-evidence.json');
      await writeFile(evidenceFile, JSON.stringify({
        schemaVersion: 1,
        reviewedBy: 'database-operator',
        reviewedAt: '2026-07-13T00:00:00.000Z',
        expiresAt: '2026-07-20T00:00:00.000Z',
        mongodbUriSha256: uriSha256,
        database: 'telegram',
        role: 'read',
      }));
      const connectMongoDB = vi.fn().mockResolvedValue(undefined);

      const result = await connectRecommendationAuditMongo({
        env: {
          MONGODB_URI: 'mongodb://write-capable.example/ignored',
          RECOMMENDATION_AUDIT_MONGODB_URI: uri,
          RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE: evidenceFile,
        },
        connectMongoDB,
        now: new Date('2026-07-14T00:00:00.000Z'),
      });

      expect(connectMongoDB).toHaveBeenCalledWith({
        uri,
        autoIndex: false,
        autoCreate: false,
      });
      expect(result.evidenceFileSha256).toMatch(/^[a-f0-9]{64}$/);
    });
  });
  ```

- [ ] **RED Step 2: Add the complete shared summary and strict-mode tests**

  Create `embeddingEvidenceAudit.test.ts` with:

  ```ts
  import { describe, expect, it } from 'vitest';

  import { REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT } from '../../src/services/recommendation/contracts/embeddingContract';
  import { LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON } from '../../src/services/recommendation/contracts/embeddingContractEvidence';
  import { summarizeEmbeddingEvidence } from '../../src/services/ops/recommendation/embeddingEvidenceAudit';

  describe('summarizeEmbeddingEvidence', () => {
    it('counts the classifier vocabulary without making semantic_ready reachable', () => {
      const vector = new Array(
        REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT.retrievalEmbeddingDim,
      ).fill(0);

      expect(summarizeEmbeddingEvidence([
        { vector, perVectorContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT },
        { vector, quarantineReason: LEGACY_SERVING_LITE_MIXED_LINEAGE_QUARANTINE_REASON },
        { vector },
        {
          vector,
          replayContract: REGISTERED_USER_COLD_START_EMBEDDING_CONTRACT,
          replayMatched: false,
        },
      ])).toEqual({
        total: 4,
        verified_local_fallback: 1,
        semantic_ready: 0,
        quarantined: 1,
        invalid: 1,
        unclassified: 1,
      });
    });
  });
  ```

  In `auditEmbeddingContracts.test.ts`, import the exported existing `parseArgs` after it accepts an argv parameter, then add:

  ```ts
  it('rejects a limited strict scan', () => {
    expect(() => parseArgs(['--strict', '--limit', '10']))
      .toThrow('embedding_audit_limited_strict_forbidden');
  });

  it('uses full scan when strict has no limit flag', () => {
    expect(parseArgs(['--strict'])).toMatchObject({
      strict: true,
      limit: undefined,
    });
  });
  ```

- [ ] **RED Step 3: Run targeted tests**

  Run:

  ```bash
  (cd telegram-clone-backend && ./node_modules/.bin/vitest run tests/recommendation/embeddingContractEvidence.test.ts tests/recommendation/auditMongoAccess.test.ts tests/recommendation/embeddingEvidenceAudit.test.ts tests/scripts/auditEmbeddingContracts.test.ts tests/recommendation/dailyRefreshOps.test.ts)
  ```

  Expected: nonzero because the current audit uses legacy shared-contract counts, a capped query, and daily ops uses separate `countDocuments` compatibility semantics.

- [ ] **GREEN Step 4: Implement the exact connection interface**

  In `db.ts`, add the options type and use it in the existing function without changing no-argument callers:

  ```ts
  export interface MongoConnectionOptions {
    uri?: string;
    autoIndex?: boolean;
    autoCreate?: boolean;
  }

  const connectMongoDB = async (
    overrides: MongoConnectionOptions = {},
  ): Promise<void> => {
    const mongoUri = overrides.uri || process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('环境变量 MONGODB_URI 未设置，请配置 MongoDB Atlas 连接字符串');
    }
    const options: mongoose.ConnectOptions = {
      serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS) || 30000,
      socketTimeoutMS: Number(process.env.MONGODB_SOCKET_TIMEOUT_MS) || 20000,
      connectTimeoutMS: Number(process.env.MONGODB_CONNECT_TIMEOUT_MS) || 30000,
      maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE) || 10,
      minPoolSize: Number(process.env.MONGODB_MIN_POOL_SIZE) || 2,
      maxIdleTimeMS: Number(process.env.MONGODB_MAX_IDLE_TIME_MS) || 30000,
      heartbeatFrequencyMS: 10000,
      bufferCommands: false,
      autoIndex: overrides.autoIndex,
      autoCreate: overrides.autoCreate,
    };
    await mongoose.connect(mongoUri, options);
  };
  ```

  Preserve the existing logging, IPv4/TLS/direct-connection, reconnect, and exported readiness behavior around this minimal change.

  Create `auditMongoAccess.ts` with this complete boundary:

  ```ts
  import { createHash } from 'node:crypto';
  import { readFile } from 'node:fs/promises';

  import {
    connectMongoDB,
    type MongoConnectionOptions,
  } from '../../../config/db';

  export interface RecommendationAuditReadOnlyEvidence {
    schemaVersion: 1;
    reviewedBy: string;
    reviewedAt: string;
    expiresAt: string;
    mongodbUriSha256: string;
    database: string;
    role: 'read';
  }

  export class RecommendationAuditMongoAccessError extends Error {
    constructor(readonly code: string, message: string) {
      super(`${code}: ${message}`);
      this.name = 'RecommendationAuditMongoAccessError';
    }
  }

  type ConnectMongoDB = (options?: MongoConnectionOptions) => Promise<void>;

  export async function connectRecommendationAuditMongo(options: {
    env?: NodeJS.ProcessEnv;
    now?: Date;
    connectMongoDB?: ConnectMongoDB;
  } = {}): Promise<{ evidenceFile: string; evidenceFileSha256: string }> {
    const env = options.env || process.env;
    const now = options.now || new Date();
    const connect = options.connectMongoDB || connectMongoDB;
    const uri = String(env.RECOMMENDATION_AUDIT_MONGODB_URI || '');
    if (!uri) {
      throw new RecommendationAuditMongoAccessError(
        'recommendation_audit_uri_missing',
        'RECOMMENDATION_AUDIT_MONGODB_URI is required',
      );
    }
    const evidenceFile = String(env.RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE || '');
    if (!evidenceFile) {
      throw new RecommendationAuditMongoAccessError(
        'recommendation_audit_evidence_file_missing',
        'RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE is required',
      );
    }

    let raw: Buffer;
    let evidence: RecommendationAuditReadOnlyEvidence;
    try {
      raw = await readFile(evidenceFile);
      evidence = JSON.parse(raw.toString('utf8')) as RecommendationAuditReadOnlyEvidence;
    } catch (error) {
      throw new RecommendationAuditMongoAccessError(
        'recommendation_audit_evidence_invalid',
        error instanceof Error ? error.message : String(error),
      );
    }
    if (evidence.schemaVersion !== 1
      || !String(evidence.reviewedBy || '').trim()
      || !String(evidence.database || '').trim()
      || !/^[a-f0-9]{64}$/.test(String(evidence.mongodbUriSha256 || ''))
      || !Number.isFinite(Date.parse(evidence.reviewedAt))
      || !Number.isFinite(Date.parse(evidence.expiresAt))) {
      throw new RecommendationAuditMongoAccessError(
        'recommendation_audit_evidence_invalid',
        'schema validation failed',
      );
    }
    if (evidence.role !== 'read') {
      throw new RecommendationAuditMongoAccessError(
        'recommendation_audit_role_not_allowed',
        'role must equal read',
      );
    }
    if (Date.parse(evidence.expiresAt) <= now.getTime()) {
      throw new RecommendationAuditMongoAccessError(
        'recommendation_audit_evidence_expired',
        `evidence expired at ${evidence.expiresAt}`,
      );
    }
    const uriDigest = createHash('sha256').update(uri, 'utf8').digest('hex');
    if (uriDigest !== evidence.mongodbUriSha256) {
      throw new RecommendationAuditMongoAccessError(
        'recommendation_audit_uri_digest_mismatch',
        'evidence does not bind the dedicated URI',
      );
    }

    await connect({ uri, autoIndex: false, autoCreate: false });
    return {
      evidenceFile,
      evidenceFileSha256: createHash('sha256').update(raw).digest('hex'),
    };
  }
  ```

- [ ] **GREEN Step 5: Implement the shared summary, exit codes, and full cursor**

  Create `embeddingEvidenceAudit.ts` with:

  ```ts
  import {
    classifyEmbeddingContractEvidence,
    type EmbeddingContractEvidenceInput,
    type EmbeddingEvidenceStatus,
  } from '../../recommendation/contracts/embeddingContractEvidence';

  export interface EmbeddingEvidenceSummary {
    total: number;
    verified_local_fallback: number;
    semantic_ready: number;
    quarantined: number;
    invalid: number;
    unclassified: number;
  }

  export function summarizeEmbeddingEvidence(
    inputs: EmbeddingContractEvidenceInput[],
  ): EmbeddingEvidenceSummary {
    const summary: EmbeddingEvidenceSummary = {
      total: inputs.length,
      verified_local_fallback: 0,
      semantic_ready: 0,
      quarantined: 0,
      invalid: 0,
      unclassified: 0,
    };
    for (const input of inputs) {
      const status: EmbeddingEvidenceStatus = classifyEmbeddingContractEvidence(input);
      summary[status] += 1;
    }
    return summary;
  }
  ```

  Change existing `parseArgs` in `auditEmbeddingContracts.ts` to accept argv and remove its default limit:

  ```ts
  export function parseArgs(argv: string[] = process.argv.slice(2)) {
    const kv: Record<string, string> = {};
    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index];
      if (!arg.startsWith('--')) continue;
      const key = arg.slice(2);
      kv[key] = argv[index + 1] && !argv[index + 1].startsWith('--')
        ? argv[index + 1]
        : 'true';
    }
    const strict = kv.strict === 'true';
    const limit = kv.limit === undefined
      ? undefined
      : Math.max(1, parseInt(kv.limit, 10) || 1);
    if (strict && limit !== undefined) {
      throw new Error('embedding_audit_limited_strict_forbidden');
    }
    return {
      strict,
      limit,
      approvedQuarantineDigest: kv['approved-quarantine-digest'],
    };
  }
  ```

  Define and use these CLI exits:

  ```ts
  export const EMBEDDING_AUDIT_EXIT = {
    pass: 0,
    evidenceFailure: 2,
    operationalError: 3,
  } as const;
  ```

  Strict/full model reads must use this uncapped shape for users and posts; only diagnostic mode adds `.limit(limit)`:

  ```ts
  for await (const user of UserFeatureVector.find({}).sort({ _id: 1 }).cursor()) {
    userInputs.push(toUserEvidenceInputs(user));
  }
  for await (const post of PostFeatureSnapshot.find({}).sort({ _id: 1 }).cursor()) {
    postInputs.push(toPostEvidenceInputWithReplay(post));
  }
  ```

  The full-scan loop constructs the classifier inputs directly from current persisted fields:

  ```ts
  for await (const user of UserFeatureVector.find({}).sort({ _id: 1 }).cursor()) {
    userInputs.push({
      vector: user.twoTowerEmbedding,
      perVectorContract: user.twoTowerEmbeddingContract,
      legacySharedContract: user.embeddingContract,
      quarantineReason: user.twoTowerEmbeddingQuarantineReason,
    });
    userInputs.push({
      vector: user.phoenixEmbedding,
      perVectorContract: user.phoenixEmbeddingContract,
      legacySharedContract: user.embeddingContract,
    });
  }
  for await (const post of PostFeatureSnapshot.find({}).sort({ _id: 1 }).cursor()) {
    const replayed = buildDensePostEmbedding({
      keywordScores: post.keywordScores,
      clusterScores: post.clusterScores,
      authorProducerClusters: post.authorProducerClusters,
      authorKnownForCluster: post.authorKnownForCluster,
      engagementBucket: post.engagementBucket,
      freshnessBucket: post.freshnessBucket,
      hasMedia: post.hasMedia,
      mediaTypes: post.mediaTypes,
      language: post.language,
    });
    postInputs.push({
      vector: post.denseEmbedding,
      perVectorContract: post.embeddingContract,
      replayContract: HEURISTIC_POST_HASH_EMBEDDING_CONTRACT,
      replayMatched: replayed.length === post.denseEmbedding.length
        && replayed.every((value, index) => value === post.denseEmbedding[index]),
    });
  }
  ```

  Both script entrypoints call `connectRecommendationAuditMongo()` before model access. Catch `RecommendationAuditMongoAccessError`, connection errors, and unexpected errors as exit `3`; only completed evidence findings return `2`.

- [ ] **GREEN Step 6: Run targeted tests**

  Run the Step 3 command again.

  Expected: exit 0; five-state counts match, strict rejects limited mode, quarantine identity drift and replay mismatch fail closed, and no test opens a live database connection.

- [ ] **GREEN Step 7: Run backend type checking**

  Run the exact backend `tsc` command from Task 4 Step 6. Expected: exit 0. Do not run either live audit in Task 5.

## Task 6: Fail-Closed Repair CLI

**Files:**

- Modify: `telegram-clone-backend/src/scripts/backfillEmbeddingContracts.ts`
- Create: `telegram-clone-backend/tests/scripts/backfillEmbeddingContracts.test.ts`
- Consume without duplicating: `telegram-clone-backend/src/services/recommendation/contracts/embeddingContractEvidence.ts`
- Consume for default dry-run connection: `telegram-clone-backend/src/services/ops/recommendation/auditMongoAccess.ts`

**Interfaces:**

- Preserve the existing `backfillEmbeddingContracts(...)` script boundary. Its default CLI mode is an uncapped, side-effect-free full dry-run; no flag is required to make it safe.
- Dry-run emits canonical machine-readable proposal JSON containing every target id, metadata-only expected patch, pre-write vector checksum, classification, quarantine digest, aggregate proposal digest, scanned totals, and zero-write counters.
- `--limit` remains available only as diagnostic mode and is rejected with apply. Diagnostic output cannot be used as an authorization proposal.
- Apply consumes `--proposal-file`, `--approved-proposal-digest`, and `--approved-quarantine-digest`; it validates the complete saved proposal before the first write. It never approves a digest generated by the same apply invocation.
- Rollback consumes `--rollback`, `--backup-file`, and `--approved-backup-digest`; vector drift or digest drift stops before the first write.
- Dry-run, apply, backup, and rollback are metadata-only. Their update keys exclude `twoTowerEmbedding`, `phoenixEmbedding`, and post `denseEmbedding`; they also exclude Redis, scheduler, process, and Python operations.
- The commands using `--apply` or `--rollback` are Task 9 operations and require separate production authorization even after all Task 6 tests pass.

**Exact Types Produced In `backfillEmbeddingContracts.ts`:**

```ts
export type EmbeddingRepairMode = 'dry-run' | 'diagnostic' | 'apply' | 'rollback';

export interface EmbeddingRepairCliOptions {
    mode: EmbeddingRepairMode;
    limit?: number;
    batchSize: number;
    proposalFile?: string;
    approvedProposalDigest?: string;
    approvedQuarantineDigest?: string;
    backupFile?: string;
    approvedBackupDigest?: string;
}

export interface EmbeddingMetadataOperation {
    collection: 'user_feature_vectors' | 'post_feature_snapshots';
    id: string;
    expectedVectorChecksum: string;
    set: Record<string, unknown>;
    unset: string[];
}

export interface EmbeddingContractRepairProposal {
    schemaVersion: 1;
    mode: 'dry-run' | 'diagnostic';
    fullScan: boolean;
    scanned: { users: number; postFeatureSnapshots: number };
    classifications: EmbeddingEvidenceSummary;
    replay: { matched: number; mismatched: number };
    operations: EmbeddingMetadataOperation[];
    quarantineDigest: string;
    proposalDigest: string;
    writeCounters: {
        mongo: 0;
        redis: 0;
        scheduler: 0;
        process: 0;
        python: 0;
    };
}

export interface EmbeddingMetadataBackup {
    schemaVersion: 1;
    operations: EmbeddingMetadataOperation[];
    backupDigest: string;
}
```

Proposal operations are sorted by `collection`, then `id`; every object is constructed with the key order shown above before SHA-256. `proposalDigest` hashes UTF-8 JSON of all fields except `proposalDigest` itself.

- [ ] **RED Step 1: Add the complete parser and metadata-only tests**

  Create `backfillEmbeddingContracts.test.ts` with these complete tests and imports:

  ```ts
  import { describe, expect, it, vi } from 'vitest';

  import {
    applyApprovedProposal,
    assertMetadataOnlyOperations,
    computeProposalDigest,
    parseArgs,
    type EmbeddingContractRepairProposal,
  } from '../../src/scripts/backfillEmbeddingContracts';

  const proposalWithoutDigest: Omit<EmbeddingContractRepairProposal, 'proposalDigest'> = {
    schemaVersion: 1,
    mode: 'dry-run',
    fullScan: true,
    scanned: { users: 1, postFeatureSnapshots: 1 },
    classifications: {
      total: 2,
      verified_local_fallback: 1,
      semantic_ready: 0,
      quarantined: 1,
      invalid: 0,
      unclassified: 0,
    },
    replay: { matched: 2, mismatched: 0 },
    operations: [{
      collection: 'user_feature_vectors',
      id: 'user-1',
      expectedVectorChecksum: 'vector-checksum-1',
      set: { twoTowerEmbeddingContract: { semantic: false } },
      unset: ['embeddingContract'],
    }],
    quarantineDigest: 'approved-quarantine-digest',
    writeCounters: { mongo: 0, redis: 0, scheduler: 0, process: 0, python: 0 },
  };
  const proposal: EmbeddingContractRepairProposal = {
    ...proposalWithoutDigest,
    proposalDigest: computeProposalDigest(proposalWithoutDigest),
  };

  describe('embedding contract repair CLI', () => {
    it('defaults to an uncapped full dry-run', () => {
      expect(parseArgs([])).toEqual({
        mode: 'dry-run',
        limit: undefined,
        batchSize: 200,
        proposalFile: undefined,
        approvedProposalDigest: undefined,
        approvedQuarantineDigest: undefined,
        backupFile: undefined,
        approvedBackupDigest: undefined,
      });
    });

    it('rejects a limited apply invocation', () => {
      expect(() => parseArgs([
        '--apply',
        '--limit', '10',
        '--proposal-file', 'proposal.json',
      ])).toThrow('embedding_repair_limited_apply_forbidden');
    });

    it('rejects vector fields in metadata operations', () => {
      expect(() => assertMetadataOnlyOperations([{
        ...proposal.operations[0],
        set: { twoTowerEmbedding: [0.1, 0.2] },
      }])).toThrow('embedding_repair_vector_field_forbidden:twoTowerEmbedding');
    });

    it('performs zero writes when proposal approval differs', async () => {
      const writeMetadataOperations = vi.fn().mockResolvedValue(1);

      await expect(applyApprovedProposal({
        proposal,
        approvedProposalDigest: 'different-proposal-digest',
        approvedQuarantineDigest: proposal.quarantineDigest,
        currentVectorChecksums: new Map([['user_feature_vectors:user-1', 'vector-checksum-1']]),
        writeMetadataOperations,
      })).rejects.toThrow('embedding_repair_proposal_digest_mismatch');

      expect(writeMetadataOperations).not.toHaveBeenCalled();
    });

    it('performs zero writes when a vector changed after proposal review', async () => {
      const writeMetadataOperations = vi.fn().mockResolvedValue(1);

      await expect(applyApprovedProposal({
        proposal,
        approvedProposalDigest: proposal.proposalDigest,
        approvedQuarantineDigest: proposal.quarantineDigest,
        currentVectorChecksums: new Map([['user_feature_vectors:user-1', 'drifted-vector']]),
        writeMetadataOperations,
      })).rejects.toThrow('embedding_repair_vector_drift:user_feature_vectors:user-1');

      expect(writeMetadataOperations).not.toHaveBeenCalled();
    });

    it('performs zero writes when saved proposal content changed after review', async () => {
      const writeMetadataOperations = vi.fn().mockResolvedValue(1);
      const tampered = {
        ...proposal,
        operations: [{ ...proposal.operations[0], id: 'user-2' }],
      };

      await expect(applyApprovedProposal({
        proposal: tampered,
        approvedProposalDigest: proposal.proposalDigest,
        approvedQuarantineDigest: proposal.quarantineDigest,
        currentVectorChecksums: new Map([['user_feature_vectors:user-2', 'vector-checksum-1']]),
        writeMetadataOperations,
      })).rejects.toThrow('embedding_repair_proposal_digest_mismatch');

      expect(writeMetadataOperations).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] **RED Step 2: Run the focused CLI test**

  Run:

  ```bash
  (cd telegram-clone-backend && ./node_modules/.bin/vitest run tests/scripts/backfillEmbeddingContracts.test.ts)
  ```

  Expected: nonzero because the current script defaults away from dry-run, caps scans, derives metadata from dimension, and writes documents directly.

- [ ] **GREEN Step 3: Implement the exact parser and metadata guards**

  Replace the existing parser with this complete argv contract:

  ```ts
  export function parseArgs(argv: string[] = process.argv.slice(2)): EmbeddingRepairCliOptions {
      const kv: Record<string, string> = {};
      for (let index = 0; index < argv.length; index += 1) {
          const arg = argv[index];
          if (!arg.startsWith('--')) continue;
          const key = arg.slice(2);
          kv[key] = argv[index + 1] && !argv[index + 1].startsWith('--')
              ? argv[index + 1]
              : 'true';
      }
      const mode: EmbeddingRepairMode = kv.rollback === 'true'
          ? 'rollback'
          : kv.apply === 'true'
              ? 'apply'
              : kv.limit === undefined
                  ? 'dry-run'
                  : 'diagnostic';
      const limit = kv.limit === undefined
          ? undefined
          : Math.max(1, parseInt(kv.limit, 10) || 1);
      if (mode === 'apply' && limit !== undefined) {
          throw new Error('embedding_repair_limited_apply_forbidden');
      }
      return {
          mode,
          limit,
          batchSize: Math.max(1, parseInt(kv.batch || '200', 10) || 200),
          proposalFile: kv['proposal-file'],
          approvedProposalDigest: kv['approved-proposal-digest'],
          approvedQuarantineDigest: kv['approved-quarantine-digest'],
          backupFile: kv['backup-file'],
          approvedBackupDigest: kv['approved-backup-digest'],
      };
  }
  ```

  Add these complete metadata-only and pre-write guards:

  ```ts
  const VECTOR_FIELDS = new Set([
      'twoTowerEmbedding',
      'phoenixEmbedding',
      'denseEmbedding',
  ]);

  export function computeProposalDigest(
      proposal: Omit<EmbeddingContractRepairProposal, 'proposalDigest'>
          | EmbeddingContractRepairProposal,
  ): string {
      const { proposalDigest: _ignored, ...input } = proposal as EmbeddingContractRepairProposal;
      const operations = [...input.operations]
          .sort((left, right) =>
              left.collection.localeCompare(right.collection) || left.id.localeCompare(right.id))
          .map((operation) => ({
              collection: operation.collection,
              id: operation.id,
              expectedVectorChecksum: operation.expectedVectorChecksum,
              set: operation.set,
              unset: [...operation.unset].sort(),
          }));
      const canonical = {
          schemaVersion: input.schemaVersion,
          mode: input.mode,
          fullScan: input.fullScan,
          scanned: input.scanned,
          classifications: input.classifications,
          replay: input.replay,
          operations,
          quarantineDigest: input.quarantineDigest,
          writeCounters: input.writeCounters,
      };
      return createHash('sha256')
          .update(JSON.stringify(canonical), 'utf8')
          .digest('hex');
  }

  export function assertMetadataOnlyOperations(
      operations: EmbeddingMetadataOperation[],
  ): void {
      for (const operation of operations) {
          for (const field of [...Object.keys(operation.set), ...operation.unset]) {
              if (VECTOR_FIELDS.has(field)) {
                  throw new Error(`embedding_repair_vector_field_forbidden:${field}`);
              }
          }
      }
  }

  export async function applyApprovedProposal(input: {
      proposal: EmbeddingContractRepairProposal;
      approvedProposalDigest: string;
      approvedQuarantineDigest: string;
      currentVectorChecksums: Map<string, string>;
      writeMetadataOperations: (operations: EmbeddingMetadataOperation[]) => Promise<number>;
  }): Promise<number> {
      const computedProposalDigest = computeProposalDigest(input.proposal);
      if (computedProposalDigest !== input.proposal.proposalDigest
          || input.approvedProposalDigest !== computedProposalDigest) {
          throw new Error('embedding_repair_proposal_digest_mismatch');
      }
      if (input.approvedQuarantineDigest !== input.proposal.quarantineDigest) {
          throw new Error('embedding_repair_quarantine_digest_mismatch');
      }
      assertMetadataOnlyOperations(input.proposal.operations);
      for (const operation of input.proposal.operations) {
          const key = `${operation.collection}:${operation.id}`;
          if (input.currentVectorChecksums.get(key) !== operation.expectedVectorChecksum) {
              throw new Error(`embedding_repair_vector_drift:${key}`);
          }
      }
      return input.writeMetadataOperations(input.proposal.operations);
  }
  ```

  `backfillEmbeddingContracts(...)` remains the only orchestration entry. In `dry-run` and `diagnostic` modes it calls `connectRecommendationAuditMongo()` and never imports a writable URI. In `apply` and `rollback` modes it refuses to start unless Task 9's separately authorized production inputs are present. Rollback uses the same vector-checksum preflight and `assertMetadataOnlyOperations(...)` before its first write.

- [ ] **GREEN Step 4: Run the focused CLI test**

  Run the Step 2 command again.

  Expected: exit 0; default mode reports zero writes and side effects, any digest/vector/classification drift reports zero writes, and apply/rollback operation shapes are metadata-only.

- [ ] **GREEN Step 5: Run backend type checking**

  Run the exact backend `tsc` command from Task 4 Step 6. Expected: exit 0. Do not execute the live dry-run, apply, or rollback command in Task 6.

## Task 7: Release Gate And Master-Plan Wiring

**Files:**

- Modify: `tools/release/verify_all.sh`
- Modify: `telegram-clone-backend/src/services/jobs/FeatureExportJob.ts`
- Test: `telegram-clone-backend/tests/recommendation/embeddingProvenance.test.ts`
- Test through deterministic Node gate: `telegram-clone-backend/tests/ops/recommendationOpsReadiness.test.ts`
- Test through deterministic Node gate: `telegram-clone-backend/tests/scripts/auditEmbeddingContracts.test.ts`
- Test through deterministic Node gate: all five Task 4 test files and `telegram-clone-backend/tests/scripts/backfillEmbeddingContracts.test.ts`
- Coordinate prerequisite wording only: `docs/superpowers/plans/2026-07-07-recommendation-next-stage-industrialization.md`

**Interfaces:**

- The release order is C++ then Go, the renderer-defined exact 18-file deterministic Node gate, Rust replay, and finally the uncapped strict audit with the independently approved digest.
- The release script invokes full strict audit without a limit. It requires `APPROVED_EMBEDDING_QUARANTINE_DIGEST` to be supplied from the independently reviewed proposal and passes it to the audit; missing or mismatched approval fails before release progression.
- The release script never parses its current audit output to populate the approval value and never blesses an empty/zero eligible user export as a replacement or promotion artifact.
- `tools/release/verify_all.sh` is wired in Task 7 but not executed until the separately authorized Task 9 post-apply gate.
- The master plan preserves Phase 0 history and makes Phase 0 plus Phase 0.5 evidence a logical-AND prerequisite for Phase 1.

- [ ] **RED Step 1: Prove the current capped strict wiring is unacceptable**

  Run:

  ```bash
  rg -n -- '--limit[[:space:]]+[0-9]+[[:space:]]+--strict' tools/release/verify_all.sh
  ```

  Expected: exit 0 with the current capped strict invocation, recorded as diagnostic evidence of the release-script defect, never as passing release evidence.

- [ ] **RED Step 2: Add exact digest and zero-export tests**

  In `auditEmbeddingContracts.test.ts`, update calls for the Task 5 exit-code contract and add:

  ```ts
  it.each([undefined, 'different-approved-digest'])(
    'fails completed strict evidence when approval is %s',
    (approvedQuarantineDigest) => {
      expect(resolveEmbeddingAuditExitCode({
        strict: true,
        summary: {
          total: 4,
          verified_local_fallback: 0,
          semantic_ready: 0,
          quarantined: 4,
          invalid: 0,
          unclassified: 0,
        },
        currentQuarantineDigest: 'current-quarantine-digest',
        approvedQuarantineDigest,
      })).toBe(2);
    },
  );
  ```

  The exact Task 5 signature becomes:

  ```ts
  export function resolveEmbeddingAuditExitCode(input: {
      strict: boolean;
      summary: EmbeddingEvidenceSummary;
      currentQuarantineDigest: string;
      approvedQuarantineDigest?: string;
  }): 0 | 2 {
      if (!input.strict) return 0;
      return input.summary.total === 0
          || input.summary.invalid > 0
          || input.summary.unclassified > 0
          || !input.approvedQuarantineDigest
          || input.currentQuarantineDigest !== input.approvedQuarantineDigest
          ? EMBEDDING_AUDIT_EXIT.evidenceFailure
          : EMBEDDING_AUDIT_EXIT.pass;
  }
  ```

  In `embeddingProvenance.test.ts`, add this complete non-publication test:

  ```ts
  it('does not replace an existing user export when no user is eligible', async () => {
    vi.spyOn(UserFeatureVector as any, 'find').mockImplementation(() => {
      const query = {
        select: vi.fn(),
        skip: vi.fn(),
        limit: vi.fn().mockResolvedValue([]),
      } as any;
      query.select.mockReturnValue(query);
      query.skip.mockReturnValue(query);
      return query;
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const outputDir = await mkdtemp(join(tmpdir(), 'feature-export-empty-'));
    const outputPath = join(outputDir, 'user_embeddings.json');
    const existing = '[{"id":"existing-index-user","vector":[1]}]\n';
    await writeFile(outputPath, existing);

    try {
      const result = await new FeatureExportJob().run({ onlyUsers: true, outputDir });
      expect(result.usersExported).toBe(0);
      expect(await readFile(outputPath, 'utf8')).toBe(existing);
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });
  ```

  Add `writeFile` to the existing `node:fs/promises` import. Expected before implementation: the existing file is overwritten with `[]`.

- [ ] **GREEN Step 3: Implement zero-export non-publication and the exact release script**

  In `FeatureExportJob.exportUserEmbeddings(...)`, place this guard immediately before `writeFile`:

  ```ts
  if (embeddings.length === 0) {
      return 0;
  }
  ```

  Replace `tools/release/verify_all.sh` with this complete ordering. This script is prepared here but remains unexecuted until authorized Task 9:

  ```bash
  #!/usr/bin/env bash
  set -euo pipefail

  ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  : "${APPROVED_EMBEDDING_QUARANTINE_DIGEST:?Set an independently approved quarantine digest}"

  if [[ ! "$APPROVED_EMBEDDING_QUARANTINE_DIGEST" =~ ^[0-9a-f]{64}$ ]]; then
    echo "APPROVED_EMBEDDING_QUARANTINE_DIGEST must be lowercase 64-hex" >&2
    exit 64
  fi

  bash "$ROOT_DIR/tools/release/verify_cpp.sh"
  bash "$ROOT_DIR/tools/release/verify_go.sh"
  npm --prefix "$ROOT_DIR/telegram-clone-backend" test -- \
    tests/recommendation/userEmbeddingQueryHydrator.test.ts \
    tests/recommendation/registeredUserFeatureBootstrap.test.ts \
    tests/recommendation/embeddingProvenance.test.ts \
    tests/recommendation/newsAnnSource.test.ts \
    tests/recommendation/denseEmbedding.test.ts \
    tests/recommendation/embeddingRetrievalPolicy.test.ts \
    tests/recommendation/embeddingContractEvidence.test.ts \
    tests/config/db.test.ts \
    tests/recommendation/auditMongoAccess.test.ts \
    tests/recommendation/embeddingEvidenceAudit.test.ts \
    tests/recommendation/embeddingRepairArtifacts.test.ts \
    tests/recommendation/embeddingRepairPlannerTransaction.test.ts \
    tests/scripts/auditEmbeddingContracts.test.ts \
    tests/scripts/auditDailyRecommendationRefresh.test.ts \
    tests/recommendation/dailyRefreshOps.test.ts \
    tests/recommendation/dailyRecommendationRefreshJob.test.ts \
    tests/scripts/backfillEmbeddingContracts.test.ts \
    tests/ops/recommendationOpsReadiness.test.ts
  cargo test \
    --manifest-path "$ROOT_DIR/telegram-rust-workspace/Cargo.toml" \
    -p telegram-rust-recommendation replay
  npm --prefix "$ROOT_DIR/telegram-clone-backend" run audit:embedding-contracts -- \
    --strict \
    --approved-quarantine-digest "$APPROVED_EMBEDDING_QUARANTINE_DIGEST"
  ```

- [ ] **GREEN Step 4: Run the deterministic Node gate directly**

  Run:

  ```bash
  (cd telegram-clone-backend && ./node_modules/.bin/vitest run tests/recommendation/userEmbeddingQueryHydrator.test.ts tests/recommendation/registeredUserFeatureBootstrap.test.ts tests/recommendation/embeddingProvenance.test.ts tests/recommendation/newsAnnSource.test.ts tests/recommendation/denseEmbedding.test.ts tests/recommendation/embeddingRetrievalPolicy.test.ts tests/recommendation/embeddingContractEvidence.test.ts tests/config/db.test.ts tests/recommendation/auditMongoAccess.test.ts tests/recommendation/embeddingEvidenceAudit.test.ts tests/recommendation/embeddingRepairArtifacts.test.ts tests/recommendation/embeddingRepairPlannerTransaction.test.ts tests/scripts/auditEmbeddingContracts.test.ts tests/scripts/auditDailyRecommendationRefresh.test.ts tests/recommendation/dailyRefreshOps.test.ts tests/recommendation/dailyRecommendationRefreshJob.test.ts tests/scripts/backfillEmbeddingContracts.test.ts tests/ops/recommendationOpsReadiness.test.ts)
  ```

  Expected: exit 0 with no database/network access.

- [ ] **GREEN Step 5: Check shell syntax and uncapped strict wiring**

  Run:

  ```bash
  bash -n tools/release/verify_all.sh
  if rg -n -- '--limit|verify_performance\.sh|(^|\s|/)python([0-9]+(\.[0-9]+)*)?(\s|$)|pytest|ml-services' tools/release/verify_all.sh; then exit 1; fi
  ```

  Expected: both commands exit 0; the canonical forbidden scan emits no match. Do not run `tools/release/verify_all.sh` in Task 7 or Task 8.

## Task 8: Code Verification And Authorization Packet

**Files And Local Artifacts:**

- No tracked source modification is expected after Tasks 4-7 review clean.
- Generate: `reports/recommendation/embedding-contract-remediation/deterministic-checks.json`
- Generate: `reports/recommendation/embedding-contract-remediation/dispatch-evidence.json`
- Generate: `reports/recommendation/embedding-contract-remediation/proposal.json`
- Generate: `reports/recommendation/embedding-contract-remediation/proposal-review.json`
- Optional generate: `reports/recommendation/embedding-contract-remediation/pre-apply-baseline-audit.json`
- Optional generate: `reports/recommendation/embedding-contract-remediation/pre-apply-baseline-audit.stderr`
- Optional generate: `reports/recommendation/embedding-contract-remediation/pre-apply-baseline-audit.exit`
- Generate: `reports/recommendation/embedding-contract-remediation/authorization-packet.md`
- Generate: `reports/recommendation/embedding-contract-remediation/SHA256SUMS`

**Interfaces And Entry Conditions:**

- Before Step 2 or any live reads, both dedicated audit environment variables are present, the operator evidence validates, and both audit entrypoints use `autoIndex: false` and `autoCreate: false`. The program treats the file as operator proof input, not as server-side authorization discovery.
- Full dry-run and optional baseline audit have no default or explicit record cap. Stable `_id` order is reported honestly and is not called snapshot isolation.
- The full dry-run proposal is independently reviewed by a proposal reviewer dispatched with `model=gpt-5.6-sol` and `reasoning_effort=ultra`. That review may approve the proposal as input to a production-authorization request; it cannot authorize Task 9.
- Optional pre-apply baseline audit may exit `0` or `2`. Exit `2` is expected when pending metadata leaves evidence invalid/unclassified and is recorded as evidence, not relabeled as success. Exit `3`, a signal/termination exit, malformed output, or missing full-scan marker is an operational failure and blocks Task 8.
- Task 8 never requires post-apply strict pass, cache/process refresh, or `verify_all.sh`. It never creates post-apply strict or verify-all artifacts.
- `RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE` raw-file SHA-256 is bound into the authorization packet along with proposal/review/dispatch evidence.
- Python tests, formatters, generators, endpoint checks, performance Python utilities, and all `ml-services/**` operations remain forbidden in Task 8.

- [ ] **RED Step 1: Confirm the authorization packet does not pre-exist as completion evidence**

  Run:

  ```bash
  test ! -e reports/recommendation/embedding-contract-remediation/authorization-packet.md
  test ! -e reports/recommendation/embedding-contract-remediation/SHA256SUMS
  ```

  Expected before packet generation: exit 0. Any stale or pre-created packet/checksum blocks Task 8 until the operator archives it explicitly.

- [ ] **GREEN Step 2: Run and record deterministic completion checks**

  After the operator evidence is issued and validated, freshly rerun the Task 7 deterministic Node gate, then:

  ```bash
  ./telegram-clone-backend/node_modules/.bin/tsc --noEmit -p telegram-clone-backend/tsconfig.json --pretty false
  bash -n tools/release/verify_all.sh
  git diff --check
  git diff --name-only -- ml-services
  git status --short -- ml-services
  ```

  Expected: test/type/syntax/diff commands exit 0; both `ml-services` commands emit no output. Write `deterministic-checks.json` using the exact schema and command constants enforced by `renderEmbeddingRemediationAuthorizationPacket.ts`: `codeStateDigest`, the exact 18-file `nodeGate`, `task4FocusedVitest`, `packetRendererVitest`, `backendTsc`, `releaseShellSyntax`, `releaseForbiddenScan`, `diffCheck`, both empty `mlServices*Lines` arrays, and the current `releaseScriptSha256`. Every check records exit `0` and its actual canonical ISO timestamp. Do not use the superseded `task7DeterministicNodeGate` field or placeholder commands.

- [ ] **GREEN Step 3: Generate the full default dry-run proposal with read-only credentials**

  Run only after the entry conditions are recorded:

  ```bash
  mkdir -p reports/recommendation/embedding-contract-remediation
  npm --prefix telegram-clone-backend run backfill:embedding-contracts -- > reports/recommendation/embedding-contract-remediation/proposal.json
  ```

  Expected: exit 0; machine-readable output matches `EmbeddingContractRepairProposal`, has `fullScan: true`, covers all current user/post records, reports all five write counters as zero, contains proposal and quarantine digests, and has `mode: "dry-run"`.

- [ ] **GREEN Step 4: Perform independent proposal review**

  Dispatch a fresh proposal reviewer with the mandatory model/effort. The reviewer reads `proposal.json`, the design, Task 5/6 interfaces, and the current diff; it verifies full-scan totals, five-state counts, replay mismatches, vector checksums, metadata-only operations, zero write counters, canonical proposal digest, and quarantine digest. The reviewer writes `proposal-review.json` with the exact structured schema enforced by the tracked renderer: approved decision, `NOT_GRANTED`, real reviewer identity/model/effort, actual review timestamp, proposal file SHA-256, proposal/quarantine/corpus digests, `fullScan: true`, and the current `codeStateDigest`.

  If any check fails, the decision is `REJECTED`, Task 8 stops, and no authorization packet is produced.

- [ ] **GREEN Step 5: Optionally record a full pre-apply baseline audit**

  After independent proposal approval, bind `APPROVED_EMBEDDING_QUARANTINE_DIGEST` to the reviewed proposal value and run this exact status-preserving block:

  ```bash
  set +e
  npm --prefix telegram-clone-backend run audit:embedding-contracts -- \
    --strict \
    --approved-quarantine-digest "$APPROVED_EMBEDDING_QUARANTINE_DIGEST" \
    > reports/recommendation/embedding-contract-remediation/pre-apply-baseline-audit.json \
    2> reports/recommendation/embedding-contract-remediation/pre-apply-baseline-audit.stderr
  baseline_exit=$?
  set -e
  printf '%s\n' "$baseline_exit" \
    > reports/recommendation/embedding-contract-remediation/pre-apply-baseline-audit.exit
  case "$baseline_exit" in
    0|2) ;;
    *) exit "$baseline_exit" ;;
  esac
  ```

  Expected: `0` records an already-clean baseline; `2` records completed evidence findings expected before metadata repair. The JSON must identify `fullScan: true`. Exit `3`, connection/program errors, missing JSON, or a limited marker blocks Task 8. This step is optional and never a completion requirement.

- [ ] **GREEN Step 6: Record dispatch evidence**

  Write `dispatch-evidence.json` with one object per Task 4-8 verifier, implementer, spec reviewer, quality reviewer, fixer, proposal reviewer, and final reviewer:

  ```json
  {
    "schemaVersion": 1,
    "codeStateDigest": "ACTUAL_CODE_STATE_DIGEST",
    "dispatches": [
      {
        "task": 4,
        "role": "implementer",
        "agentId": "ACTUAL_AGENT_ID",
        "model": "gpt-5.6-sol",
        "reasoningEffort": "ultra",
        "status": "DONE",
        "finishedAt": "ACTUAL_ISO_TIMESTAMP"
      }
    ]
  }
  ```

  Every actual dispatch is present; the single row illustrates the exact object schema and is not a substitute for the full ledger. Required independent roles use distinct real agent ids across the ledger; a fixer may reuse its implementer identity.

- [ ] **GREEN Step 7: Render the complete code-and-dry-run authorization packet**

  Run the tracked, reviewed renderer. It rejects stale outputs, path conflicts, invalid evidence, non-independent reviewers, partial publication, and command drift:

  ```bash
  (cd telegram-clone-backend && ./node_modules/.bin/ts-node src/scripts/renderEmbeddingRemediationAuthorizationPacket.ts)
  ```

  Expected: renderer exits 0 and the packet says `CODE_AND_DRY_RUN_READY`, `NOT GRANTED`, `UNAUTHORIZED`, and `Phase 0.5 gate complete: NO`.

- [ ] **GREEN Step 8: Verify hashed pre-apply artifacts and stop**

  Run:

  ```bash
  test -s reports/recommendation/embedding-contract-remediation/authorization-packet.md
  test -s reports/recommendation/embedding-contract-remediation/SHA256SUMS
  (cd reports/recommendation/embedding-contract-remediation && shasum -a 256 -c SHA256SUMS)
  ```

  Expected: exit 0. Task 8 status is only code-and-dry-run ready. Stop and request separate production authorization; do not run apply, rollback, cache deletion, scheduler control, process restart, post-apply strict audit, `verify_all.sh`, or Python writer restoration.

## Task 9: Separately Authorized Production Apply

**Status:** UNAUTHORIZED. 以下所有 checkbox 保持未勾选，直到用户明确授权 writer pause、Mongo metadata apply、failure rollback、cache deletion、Node process refresh 和 post-apply gates。

**Files And Post-Apply Artifacts:**

- Generate and consume post-pause proposal: `reports/recommendation/embedding-contract-remediation/post-pause-proposal.json`
- Generate and consume post-pause backup: `reports/recommendation/embedding-contract-remediation/post-pause-metadata-backup.json`
- Consume external proposal approval: `reports/recommendation/embedding-contract-remediation/post-pause-proposal-approval.json`
- Consume external backup approval: `reports/recommendation/embedding-contract-remediation/post-pause-backup-approval.json`
- Consume external writer-pause evidence: `reports/recommendation/embedding-contract-remediation/writer-pause-evidence.json`
- Consume separate apply/rollback authorizations: `reports/recommendation/embedding-contract-remediation/apply-production-authorization.json` and `reports/recommendation/embedding-contract-remediation/rollback-production-authorization.json`
- Generate: `reports/recommendation/embedding-contract-remediation/post-apply-strict-audit.json`
- Generate: `reports/recommendation/embedding-contract-remediation/post-apply-strict-audit.stderr`
- Generate: `reports/recommendation/embedding-contract-remediation/post-apply-verify-all.log`
- Generate: `reports/recommendation/embedding-contract-remediation/post-apply-gate-status.env`
- Update after success only: `reports/recommendation/embedding-contract-remediation/authorization-packet.md`

**Execution Boundary:**

- 仅在用户明确批准生产 mutation、writer pause 与失败回滚后执行。
- Task 8 的 code-and-dry-run authorization packet 是审阅输入，不是生产授权本身。
- Writer pause 后重新生成权威证据，并只执行 digest-bound metadata apply。
- Apply 后完成缓存与进程一致性处理；任一验证失败都执行 metadata-only rollback。
- 只有严格验证通过后才恢复获批准的 Node jobs，Python writer 保持禁用。

- [ ] **Authorized Step 1: Record production authorization and pause writers**

  Record the authorization identity, timestamp, approved proposal/backup/quarantine digests, exact writer-pause commands, exact rollback scope, cache key scope, and Node process refresh commands in the packet before execution. Apply and rollback require separate external authorization files with their matching `operation` value. The repository has no universal scheduler/process-control command; only the operator-approved commands recorded in the authorization response may be run. Keep the Python feature refresh writer disabled without modifying Python source.

- [ ] **Authorized Step 2: Re-run full dry-run after writer pause and review the fresh digest**

  With the dedicated read-only URI/evidence file still bound, run:

  ```bash
  npm --prefix telegram-clone-backend run backfill:embedding-contracts -- \
    --proposal-file reports/recommendation/embedding-contract-remediation/post-pause-proposal.json \
    --backup-file reports/recommendation/embedding-contract-remediation/post-pause-metadata-backup.json
  ```

  Expected: exit 0, `fullScan: true`, all write counters zero, and a proposal-bound metadata backup. Fresh independent reviewers must approve both artifact digests before apply; the reviewer/operator supplies the approval, production-authorization, and writer-pause files. The program must not generate its own authorization.

- [ ] **Authorized Step 3: Execute digest-bound metadata-only apply**

  Export the independently approved values, then run:

  ```bash
  npm --prefix telegram-clone-backend run backfill:embedding-contracts -- \
    --apply \
    --proposal-file reports/recommendation/embedding-contract-remediation/post-pause-proposal.json \
    --backup-file reports/recommendation/embedding-contract-remediation/post-pause-metadata-backup.json \
    --proposal-approval-file reports/recommendation/embedding-contract-remediation/post-pause-proposal-approval.json \
    --backup-approval-file reports/recommendation/embedding-contract-remediation/post-pause-backup-approval.json \
    --production-authorization-file reports/recommendation/embedding-contract-remediation/apply-production-authorization.json \
    --writer-pause-evidence-file reports/recommendation/embedding-contract-remediation/writer-pause-evidence.json \
    --approved-proposal-digest "$APPROVED_EMBEDDING_PROPOSAL_DIGEST" \
    --approved-quarantine-digest "$APPROVED_EMBEDDING_QUARANTINE_DIGEST" \
    --approved-backup-digest "$APPROVED_EMBEDDING_BACKUP_DIGEST"
  ```

  Expected: exit 0; only approved metadata fields change; backup is non-empty; before/after vector checksums are identical. Any preflight mismatch must leave write count zero.

- [ ] **Authorized Step 4: Perform approved cache/process refresh**

  Run only the exact cache deletion and Node refresh commands recorded in the production authorization. Delete only approved `fcs:emb:*` and `sc:embed:*` keys. Roll approved Node serving processes, or wait longer than the configured L1 TTL after Redis deletion. Do not restore the Python writer.

- [ ] **Authorized Step 5: Require post-apply full strict audit exit 0**

  Run Steps 5-7 as one shell block with the dedicated read-only URI/evidence file and the approved digest:

  ```bash
  POST_APPLY_FAILURE_EXIT=0
  POST_APPLY_STRICT_EXIT=0
  POST_APPLY_VERIFY_ALL_EXIT=not_run
  POST_APPLY_VERIFY_ALL_STATUS=skipped_strict_failure
  POST_APPLY_ROLLBACK_EXIT=not_run
  POST_APPLY_STATUS_WRITE_EXIT=0

  if npm --prefix telegram-clone-backend run audit:embedding-contracts -- \
      --strict \
      --approved-quarantine-digest "$APPROVED_EMBEDDING_QUARANTINE_DIGEST" \
      > reports/recommendation/embedding-contract-remediation/post-apply-strict-audit.json \
      2> reports/recommendation/embedding-contract-remediation/post-apply-strict-audit.stderr; then
    :
  else
    POST_APPLY_STRICT_EXIT=$?
    POST_APPLY_FAILURE_EXIT=$POST_APPLY_STRICT_EXIT
  fi

  if (( POST_APPLY_STRICT_EXIT == 0 )); then
    POST_APPLY_VERIFY_ALL_STATUS=running
    if bash tools/release/verify_all.sh \
        > reports/recommendation/embedding-contract-remediation/post-apply-verify-all.log \
        2>&1; then
      POST_APPLY_VERIFY_ALL_EXIT=0
      POST_APPLY_VERIFY_ALL_STATUS=passed
    else
      POST_APPLY_VERIFY_ALL_EXIT=$?
      POST_APPLY_VERIFY_ALL_STATUS=failed
      POST_APPLY_FAILURE_EXIT=$POST_APPLY_VERIFY_ALL_EXIT
    fi
  fi

  if printf '%s\n' \
      "POST_APPLY_FAILURE_EXIT=$POST_APPLY_FAILURE_EXIT" \
      "POST_APPLY_STRICT_EXIT=$POST_APPLY_STRICT_EXIT" \
      "POST_APPLY_VERIFY_ALL_EXIT=$POST_APPLY_VERIFY_ALL_EXIT" \
      "POST_APPLY_VERIFY_ALL_STATUS=$POST_APPLY_VERIFY_ALL_STATUS" \
      "POST_APPLY_ROLLBACK_EXIT=$POST_APPLY_ROLLBACK_EXIT" \
      "POST_APPLY_STATUS_WRITE_EXIT=$POST_APPLY_STATUS_WRITE_EXIT" \
      > reports/recommendation/embedding-contract-remediation/post-apply-gate-status.env; then
    :
  else
    POST_APPLY_STATUS_WRITE_EXIT=$?
    if (( POST_APPLY_FAILURE_EXIT == 0 )); then
      POST_APPLY_FAILURE_EXIT=$POST_APPLY_STATUS_WRITE_EXIT
    fi
  fi

  if (( POST_APPLY_FAILURE_EXIT != 0 )); then
    if npm --prefix telegram-clone-backend run backfill:embedding-contracts -- \
        --rollback \
        --proposal-file reports/recommendation/embedding-contract-remediation/post-pause-proposal.json \
        --backup-file reports/recommendation/embedding-contract-remediation/post-pause-metadata-backup.json \
        --proposal-approval-file reports/recommendation/embedding-contract-remediation/post-pause-proposal-approval.json \
        --backup-approval-file reports/recommendation/embedding-contract-remediation/post-pause-backup-approval.json \
        --production-authorization-file reports/recommendation/embedding-contract-remediation/rollback-production-authorization.json \
        --writer-pause-evidence-file reports/recommendation/embedding-contract-remediation/writer-pause-evidence.json \
        --approved-proposal-digest "$APPROVED_EMBEDDING_PROPOSAL_DIGEST" \
        --approved-quarantine-digest "$APPROVED_EMBEDDING_QUARANTINE_DIGEST" \
        --approved-backup-digest "$APPROVED_EMBEDDING_BACKUP_DIGEST"; then
      POST_APPLY_ROLLBACK_EXIT=0
    else
      POST_APPLY_ROLLBACK_EXIT=$?
    fi

    if printf '%s\n' \
        "POST_APPLY_FAILURE_EXIT=$POST_APPLY_FAILURE_EXIT" \
        "POST_APPLY_STRICT_EXIT=$POST_APPLY_STRICT_EXIT" \
        "POST_APPLY_VERIFY_ALL_EXIT=$POST_APPLY_VERIFY_ALL_EXIT" \
        "POST_APPLY_VERIFY_ALL_STATUS=$POST_APPLY_VERIFY_ALL_STATUS" \
        "POST_APPLY_ROLLBACK_EXIT=$POST_APPLY_ROLLBACK_EXIT" \
        "POST_APPLY_STATUS_WRITE_EXIT=$POST_APPLY_STATUS_WRITE_EXIT" \
        > reports/recommendation/embedding-contract-remediation/post-apply-gate-status.env; then
      :
    else
      POST_APPLY_STATUS_WRITE_EXIT=$?
      printf '%s\n' \
        "POST_APPLY_FAILURE_EXIT=$POST_APPLY_FAILURE_EXIT" \
        "POST_APPLY_STRICT_EXIT=$POST_APPLY_STRICT_EXIT" \
        "POST_APPLY_VERIFY_ALL_EXIT=$POST_APPLY_VERIFY_ALL_EXIT" \
        "POST_APPLY_VERIFY_ALL_STATUS=$POST_APPLY_VERIFY_ALL_STATUS" \
        "POST_APPLY_ROLLBACK_EXIT=$POST_APPLY_ROLLBACK_EXIT" \
        "POST_APPLY_STATUS_WRITE_EXIT=$POST_APPLY_STATUS_WRITE_EXIT" \
        >&2 || :
    fi
  fi

  if (( POST_APPLY_FAILURE_EXIT != 0 )); then
    if (( POST_APPLY_ROLLBACK_EXIT != 0 )); then
      exit "$POST_APPLY_ROLLBACK_EXIT"
    fi
    exit "$POST_APPLY_FAILURE_EXIT"
  fi
  ```

  Expected: exit 0 with full scan, `invalid = 0`, `unclassified = 0`, every non-empty vector verified or approved quarantine, exact post replay, and matching quarantine digest. Exit `2` is a post-apply failure and triggers Authorized Step 7; exit `3` is an operational failure and also triggers Authorized Step 7.

- [ ] **Authorized Step 6: Require post-apply `verify_all.sh` exit 0**

  The Step 5-7 block runs `verify_all.sh` only after strict audit exit 0. A strict failure records `POST_APPLY_VERIFY_ALL_STATUS=skipped_strict_failure` and enters rollback without running verification.

  Expected: exit 0. This is the sole Phase 0.5 execution of `verify_all.sh`. Python utilities, tests, formatters, generators, endpoint checks, performance scripts, and all `ml-services/**` operations remain forbidden.

- [ ] **Authorized Step 7: Roll back metadata on any post-apply failure**

  If apply, refresh, strict audit, or `verify_all.sh` fails, do not restore jobs. The Step 5-7 block runs the separately authorized rollback for strict, verification, or status-write failure, records the gate, rollback, and status-write exits in `post-apply-gate-status.env`, then exits. Apply or refresh failure must enter the same separately authorized rollback path before post-apply gates.

  Expected: metadata-only rollback, unchanged vector checksums, approved cache invalidation/process refresh repeated, and a fresh full read-only audit recorded. Production completion remains false.

- [ ] **Authorized Step 8: Restore approved Node jobs and close Phase 0.5**

  Only after Steps 5 and 6 both exit 0, restore the specifically authorized Node refresh/export jobs. Keep the Python writer disabled. Append post-apply strict and `verify_all.sh` hashes/exits to the packet and change `Phase 0.5 gate complete` to `YES`.

**Post-Apply Acceptance:**

- 向量数组 apply 前后 checksum 不变。
- 每个 live user dense vector 有 verified per-vector contract 或 approved quarantine。
- Replay-verified post 拥有正确 heuristic non-semantic contract。
- Quarantine count 与 approved digest 保持一致。
- Post-apply strict audit exit 0 and `tools/release/verify_all.sh` exit 0 are both recorded.
- Python 代码未修改，Python writer 未恢复。

## Completion Protocol

- 每个 Task 的实现、规格审查、质量审查和验证证据都必须记录。
- 每份调度记录必须包含实际 agent id、`model=gpt-5.6-sol` 与 `reasoning_effort=ultra`；缺项或降级的结果不得用于完成声明。
- Task 1-4 完成后执行 writer/consumer integration gate。
- Task 5-7 完成后执行 audit/CLI/release integration gate。
- Task 8 完成确定性 checks、full dry-run、独立 proposal review、可选 baseline audit 和授权包后，状态只能是 code-and-dry-run ready；不要求 strict pass，不运行 `verify_all.sh`，不声明 Phase 0.5 gate complete。
- Task 9 未获单独授权时保持 `UNAUTHORIZED`。只有授权后的 metadata apply、cache/process refresh、post-apply strict exit 0 与 post-apply `verify_all.sh` exit 0 全部完成，才能声明 Phase 0.5 gate complete。
- 全部获授权任务完成后，使用 `superpowers:verification-before-completion` 和 `superpowers:finishing-a-development-branch` 收尾。

## Mandatory Completion Checks

- Exact 18-file deterministic Node gate:

  ```bash
  (cd telegram-clone-backend && ./node_modules/.bin/vitest run tests/recommendation/userEmbeddingQueryHydrator.test.ts tests/recommendation/registeredUserFeatureBootstrap.test.ts tests/recommendation/embeddingProvenance.test.ts tests/recommendation/newsAnnSource.test.ts tests/recommendation/denseEmbedding.test.ts tests/recommendation/embeddingRetrievalPolicy.test.ts tests/recommendation/embeddingContractEvidence.test.ts tests/config/db.test.ts tests/recommendation/auditMongoAccess.test.ts tests/recommendation/embeddingEvidenceAudit.test.ts tests/recommendation/embeddingRepairArtifacts.test.ts tests/recommendation/embeddingRepairPlannerTransaction.test.ts tests/scripts/auditEmbeddingContracts.test.ts tests/scripts/auditDailyRecommendationRefresh.test.ts tests/recommendation/dailyRefreshOps.test.ts tests/recommendation/dailyRecommendationRefreshJob.test.ts tests/scripts/backfillEmbeddingContracts.test.ts tests/ops/recommendationOpsReadiness.test.ts)
  ```

- Task 4 focused Vitest:

  ```bash
  (cd telegram-clone-backend && ./node_modules/.bin/vitest run tests/recommendation/userEmbeddingQueryHydrator.test.ts tests/recommendation/embeddingProvenance.test.ts tests/recommendation/newsAnnSource.test.ts tests/recommendation/denseEmbedding.test.ts tests/recommendation/embeddingRetrievalPolicy.test.ts)
  ```

- Authorization-packet renderer focused Vitest:

  ```bash
  (cd telegram-clone-backend && ./node_modules/.bin/vitest run tests/scripts/renderEmbeddingRemediationAuthorizationPacket.test.ts)
  ```

- Backend type checking; do not substitute a nonexistent npm typecheck script:

  ```bash
  ./telegram-clone-backend/node_modules/.bin/tsc --noEmit -p telegram-clone-backend/tsconfig.json --pretty false
  ```

- Shell and diff scope:

  ```bash
  bash -n tools/release/verify_all.sh
  if rg -n -- '--limit|verify_performance\.sh|(^|\s|/)python([0-9]+(\.[0-9]+)*)?(\s|$)|pytest|ml-services' tools/release/verify_all.sh; then exit 1; fi
  git diff --check
  git diff --name-only -- ml-services
  git status --short -- ml-services
  ```

- Static release contract: the renderer-focused test pins the lowercase 64-hex approval-digest guard and the exact C++ -> Go -> 18-file Node -> Rust replay -> uncapped strict order; `releaseScriptSha256` binds that exact script.

- Task 8 must bind the SHA-256 of `RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE`, produce a full uncapped dry-run proposal, and distinguish optional baseline exit `2` from operational exit `3`.
- `tools/release/verify_all.sh` is forbidden before the separately authorized Task 9 post-apply gate. Task 8 has no strict-pass or verify-all completion condition.
- No Python utilities, tests, formatters, generators, endpoint checks, performance scripts, or `ml-services/**` commands are permitted, including inside Task 9's post-apply `verify_all.sh`.

## Execution Handoff

- Resume at Task 4; Tasks 1-3 remain complete and are not reimplemented.
- Before every verifier, implementer, reviewer, fixer, or final-review dispatch, explicitly set `model=gpt-5.6-sol` and `reasoning_effort=ultra`, then record actual agent id/model/effort in phase evidence.
- Give each fresh implementer only the current Task section, Global Constraints, and current-file diff context. Review specification compliance before code quality, then close all important findings before advancing.
- Task 4-7 use deterministic task-scoped checks only. Task 8 owns full dry-run, independent proposal review, optional pre-apply baseline evidence, read-only evidence SHA binding, and the code-and-dry-run authorization packet.
- Completion through Task 8 means only code-and-dry-run ready. It does not require baseline pass and cannot run `verify_all.sh`.
- Task 9 remains `UNAUTHORIZED` until the user separately approves production writer pause, metadata apply, failure rollback, cache deletion, process refresh, post-apply strict, post-apply `verify_all.sh`, and the explicit non-restoration of the Python writer.
