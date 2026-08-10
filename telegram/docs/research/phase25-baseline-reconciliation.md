# Phase 25 Randomized Logging Baseline Reconciliation

## Scope and verdict

This is the second read-only audit of the `baseline_uncommitted` stop condition.
It reconciles the current Git state with the `telegram-phase25-current` code graph;
it does not claim ownership of any existing implementation file.

```text
phase25EngineeringStatus = not_run_baseline_uncommitted
loggingPolicySelectionStatus = no_logging_policy_selected
developmentEvidenceStatus = not_run
selectedMethod = diagnostics_only_abstention_v1
candidateQualificationStatus = not_run
runtimeActivationStatus = activation_not_authorized
```

The verdict remains `NO-GO / baseline_uncommitted`. No randomized-policy code
has a safe autonomous commit boundary in the current worktree.

## Audit anchor

```text
repository root = /Users/achilles/Documents/telegram_code
worktree prefix = telegram/
audited HEAD = 8c854dab
code graph = telegram-phase25-current
graph nodes = 22,213
graph edges = 82,426
index state before this audit = empty
```

The graph and source inspection establish these call boundaries:

- `buildRecommendationDecisionLogV1` is called by `SpaceService`, then by the
  feed route. It is not an isolated offline utility.
- `verifyRandomizedSlateSimulationV1` feeds synthetic trajectory verification.
- `build_target_distribution_stream` has only test/fixture callers in the
  current graph.
- The private Rust randomized-slate simulator and the offline producer both
  depend on the same epsilon-Plackett-Luce primitive. Reimplementing that math
  to avoid the dirty baseline would create a second canonical owner.

## Coherent dependency groups

| Group | Required paths | Current Git state | Reconciliation result |
|---|---|---|---|
| Probability owner | `telegram-randomized-policy-primitives/**` | untracked; no Git history | ownership unknown |
| Rust wire contracts | `canonical.rs`, `decision_log.rs`, `randomized_slate.rs`, `target_distribution.rs` and contract tests | primarily untracked; module wiring tracked-modified | incomplete and mixed |
| Online simulator | `telegram-rust-recommendation/src/serving/policy/randomized_slate/**` plus crate/module wiring | implementation untracked; wiring tracked-modified | incomplete and mixed |
| Offline target distribution | `telegram-recommendation-policy-offline/**` plus workspace, lockfile, contracts and fixtures | implementation untracked; shared wiring tracked-modified | incomplete and mixed |
| Node Decision Log | `decisionLog/contracts.ts`, `decisionLog/write.ts`, `RecommendationTrace.ts`, `SpaceService`, focused tests | contracts tracked-clean; writer/tests untracked; model/service tracked-modified | incomplete and mixed |
| Node randomized verifier | `randomizedSlate/contracts.ts`, `randomizedSlate/verify.ts`, synthetic trajectory consumers and fixtures | verifier tracked-clean; supporting baseline spans untracked and mixed files | no standalone capability |
| Cross-runtime evidence | fixture manifest, randomized/decision/target JSON, `cross_runtime_contract.rs` | untracked and shared with unrelated fixtures | ownership and scope unknown |

The clean tracked Node contract/verifier files do not form a new commit: they
are already in `HEAD`, and their presence cannot confer ownership on the
untracked producers, writer, tests, or fixtures.

## Mixed tracked files

The following files cannot be staged as whole-file Phase 25 changes:

- Workspace `Cargo.toml` combines randomized/offline crate membership with a
  Tokio `sync` feature change.
- `telegram-recommendation-contracts/src/contracts/mod.rs` combines Decision
  Log, randomized-slate and target-distribution exports with graph-batch work.
- `Cargo.lock` covers randomized primitives, the offline crate, SHA-256 and
  multiple changed workspace packages. It must be regenerated from an
  owner-approved manifest set, not hand-selected by hunk.
- `SpaceService` combines Decision Log wiring with request/decision identity,
  self-post merging, page-result changes and trace behavior.
- `RecommendationTrace`, exporter paths, fixture manifests and cross-runtime
  tests span multiple historical phases and responsibilities.

Mechanical hunk splitting would not resolve authorship. Git has no commit
history for the core untracked paths, and file timestamps only show that the
files predate the Phase 25 research; timestamps do not identify an owner or
authorize a commit.

## Why validation is insufficient

Focused Rust and Node tests recorded in the Phase 25 matrix prove that the
current filesystem can execute selected paths. They do not prove:

- who authored the untracked blobs;
- whether all shared tracked hunks belong to the same change;
- whether the current lockfile is reproducible from an authorized manifest;
- whether runtime Decision Log activation is authorized; or
- whether synthetic propensity can be promoted to real logging evidence.

Accordingly, a passing test suite cannot discharge `baseline_uncommitted`.

## Minimum owner decision

Re-entry requires one of the following forms of authoritative evidence:

1. A commit or ref containing the intended baseline; or
2. Explicit ownership and commit authorization for an exact path/blob list,
   plus hunk-level ownership for every shared tracked file.

The decision must separately identify these three boundaries:

```text
node_deterministic_decision_log
rust_randomized_slate_simulation
offline_target_distribution
```

After that decision, `Cargo.lock` must be regenerated from the approved
manifests and the resulting groups independently verified and committed. Until
then, Phase 25 must not add a candidate adapter, seed/reveal contract, evidence
sink, activation switch, or another `not_ready` machine wrapper.

## Preserved safety boundary

This audit makes no production change. Decision Log remains default-off and
deterministic; randomized serving, exploration, Promotion and Task 9 remain
unauthorized. The existing inference blockers remain:

```text
finite_sample_inference_unavailable
multiplicity_control_unavailable
```

No `ml-services/**` file was read, modified or tested for this reconciliation.
