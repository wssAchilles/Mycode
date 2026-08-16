# Phase 41 Replay Clock Determinism

## Scope and verdict

本阶段只审查 Rust replay evaluator 的时间语义，不修改生产 scorer、OPE、Promotion、Decision Log 或 runtime 接线。当前 `evaluate_scenario` 的输入相同并不保证完整 score/rank 结果相同：`normalize_replay_clock` 以 `Utc::now() - 48h` 平移 fixture，随后 replay 可达的 filter/scorer 又各自读取当前墙钟。

结论：

- 现状的 wall-clock dependency attribution：`GO`，仅 offline diagnostic；
- 完整 deterministic replay：`CONDITIONAL GO`，必须把一个 fixture-bound UTC anchor 传遍所有 replay-reachable time-dependent filter/scorer；
- 只修改 `normalize_replay_clock`：`NO-GO`，仍会留下独立 `Utc::now()` 读取；
- 生产时间抽象、OPE/inference、candidate selection、Promotion 和 exploration：`NO-GO`，本阶段不扩大范围。

## Code facts and call path

```text
evaluate_scenario
  -> normalize_replay_clock (Utc::now() - 48h)
  -> run_pre_score_filters (age_filter reads Utc::now())
  -> run_local_scorers
       -> ScoringContext (does not carry an evaluation clock)
       -> heuristic/calibration/rule helpers read Utc::now() independently
  -> selector and replay assertions
```

已确认的 replay-reachable 时间读取包括：

- `replay/evaluator.rs::normalize_replay_clock`：按当前时刻计算平移量，并同步 candidate/query 时间戳；
- `pipeline/local/filters/mod.rs::age_filter`：按当前时刻判断年龄边界；
- `pipeline/local/scoring/rule_signals.rs`：freshness、content velocity、negative feedback 和 hour-of-day 分支；
- `pipeline/local/scorers/helpers/signals.rs`：freshness multiplier 与 stale/exploration risk；
- `pipeline/local/scorers/heuristic_rescoring/context.rs`：创建独立的 `Utc::now()` context；
- `pipeline/local/scorers/calibration.rs`：recency plan 捕获当前时刻。

因此，一次平移不能冻结全链路。相邻调用的微秒/秒差还可能在年龄、整小时或阈值分支处改变结果；输出也没有绑定 replay anchor 的 receipt。当前 graph/本地调用检查未发现 SpaceService、route、worker、scheduler、selector 或生产 caller。

## Research questions

1. `Utc::now()`、`SystemTime` 和 processing time 是否能作为历史 replay 的确定性输入？
2. 把 fixture 时间戳平移到 `now - 48h` 是否足以冻结所有可达 scorer，还是必须传递同一 anchor？
3. 事件时间、处理时间和单调耗时应如何分离，才能重放同一输入并保持边界分支一致？
4. 最小修复应如何限制在 offline replay，避免改变生产请求的实时语义？
5. 在没有随机 propensity/PIT/qHat provenance 的情况下，时钟修复能否解除 OPE 或 finite-sample blocker？

## Evidence matrix

| Source | Data/clock assumptions and failure modes | Repository mapping | Decision |
|---|---|---|---|
| Chrono maintainers (2026), **“Utc in chrono::offset - Rust”**, chrono 0.4.45 API docs, `full_text`, [official docs](https://docs.rs/chrono/latest/chrono/offset/struct.Utc.html) | `Utc::now()` returns the current UTC date-time from the system clock. It is an execution-time observation, not a value derived from a replay fixture. | `normalize_replay_clock`, `rule_signals`, scorer helpers and calibration each call `Utc::now()`. | Adopt the mechanical finding: replay must bind an explicit fixture/event-time anchor; do not use adjacent wall-clock calls as a contract. |
| The Rust Project (2026), **“SystemTime in std::time - Rust”**, Rust 1.97.1 standard-library docs, `full_text`, [official docs](https://doc.rust-lang.org/stable/std/time/struct.SystemTime.html) | `SystemTime` is not monotonic; system adjustment can make a later observation earlier. It is suitable for talking to external system entities, not for assuming deterministic elapsed behavior. | Chrono's current-time path ultimately observes system time; replay currently has no serialized clock input. | Reject system wall clock as replay semantics. Keep it only as optional operational metadata, never as a score/rank input. |
| Rust Project (2015), **“1288-time-improvements”**, Rust RFC 1288, `full_text`, [official RFC](https://rust-lang.github.io/rfcs/1288-time-improvements.html) | Separates wall-clock `SystemTime` from monotonic `Instant`; explicitly warns that system time can move because of NTP and should not drive in-process duration/benchmark semantics. | Replay needs a serializable `DateTime<Utc>` event/evaluation anchor, not a generic monotonic timer. | Adopt the separation. Do not substitute `Instant` for fixture time; it is opaque and not serializable. |
| Apache Flink Project (2026), **“Streaming Analytics — Event Time and Watermarks”**, Flink 2.3 stable docs, `full_text`, [official docs](https://nightlies.apache.org/flink/flink-docs-stable/docs/learn-flink/streaming_analytics/) | Event time comes from the record; processing time comes from the machine clock. Processing-time results are execution-dependent and are harder to reproduce for historical data. | Replay fixture timestamps are the closest available event-time source; `Utc::now()` is processing time. | Adopt the event/processing distinction for offline diagnostics. No watermark/streaming implementation is introduced. |
| Tyler Akidau et al. (2015), **“The Dataflow Model: A Practical Approach to Balancing Correctness, Latency, and Cost in Massive-Scale, Unbounded, Out-of-Order Data Processing”**, *PVLDB* 8(12), `full_text`, DOI [10.14778/2824032.2824076](https://doi.org/10.14778/2824032.2824076) | Event-time logic is tied to logical data time, while processing-time logic advances with execution. Mixing them changes results when the same data is run later. | Candidate/query timestamp normalization without propagating the same anchor leaves reachable scorer branches tied to execution time. | Adopt as design evidence for one anchor through the replay path; it does not justify any OPE or inference claim. |
| Jingyu Zhou et al. (2021), **“FoundationDB: A Distributed Unbundled Transactional Key Value Store”**, *SIGMOD 2021*, `full_text`, DOI [10.1145/3448016.3457559](https://doi.org/10.1145/3448016.3457559) | FoundationDB's deterministic simulator abstracts time, randomness and communication and replays a seeded run exactly. Determinism requires eliminating all unmodeled nondeterminism, not only one timestamp adjustment. | Phase 41 should enumerate every replay-reachable time read and bind it to the same anchor; a single `normalize_replay_clock` change is insufficient. | Adopt only the engineering principle for offline replay. Do not copy the simulator or add a production clock framework. |
| Oracle (2020), **“Class Clock”**, Java SE 15 API docs, `full_text`, [official docs](https://docs.oracle.com/en/java/javase/15/docs/api/java.base/java/time/Clock.html) | APIs that need the current instant can receive a `Clock`; fixed clocks make tests independent of the current time. | A narrow Rust equivalent is an explicit `DateTime<Utc>`/context parameter on replay-reachable functions; no general trait is required yet. | Adopt as cross-language API evidence, not as a dependency or production refactor mandate. |
| Lihong Li, Wei Chu, John Langford, Xuanhui Wang (2011), **“Unbiased Offline Evaluation of Contextual-bandit-based News Article Recommendation Algorithms”**, *WSDM 2011*, `full_text`, [official paper](https://arxiv.org/abs/1003.5956) | Counterfactual offline evaluation assumes logged events and a randomized logging policy with valid propensities; deterministic clock control does not create those assumptions. | Replay is deterministic fixture evaluation, not `logged_randomized` evidence; OPE/finite-sample blockers remain. | Reject as a method source for Phase 41; retain only to prevent over-interpreting clock determinism as inference readiness. |

## Candidate scope and gates

The smallest decision-complete follow-up is a replay-only clock contract:

1. derive one deterministic anchor from the fixture/source contract (or reject the input if no anchor can be derived);
2. pass that anchor through every replay-reachable age, freshness, action-recency, time-of-day and calibration branch;
3. include the anchor in an offline diagnostic digest and assert repeated evaluation is byte-stable;
4. leave runtime scoring on its existing real-time path and keep all production callers absent.

The implementation must fail closed if a new replay-reachable `now` call is introduced without the anchor. A test-only time pause is insufficient: Tokio's paused clock controls Tokio `Instant`, not `chrono::Utc::now()` or `std::time` clocks.

Even after deterministic replay succeeds, the result remains diagnostic-only:

```text
selectedMethod = diagnostics_only_abstention_v1
candidateQualificationStatus = not_run
realDatasetEligible = false
finite_sample_inference_unavailable
multiplicity_control_unavailable
```

No amount of clock determinism supplies randomized propensity, PIT snapshot, viewer/time cluster provenance, qHat cross-fitting, or support evidence.
