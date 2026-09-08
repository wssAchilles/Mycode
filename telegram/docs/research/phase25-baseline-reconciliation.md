# Phase 25 Randomized Logging Baseline Reconciliation

## Phase 25 closure (2026-08-15)

This document is retained as the read-only audit snapshot anchored at
`8c854dab`. Its ownership stop condition was subsequently discharged by an
explicit owner approval covering the complete working tree and the shared
Cargo, contracts, `SpaceService`, and `RecommendationTrace` hunks.

The approved dependency closures were focused-verified and committed. At the
re-entry checkpoint `HEAD 11aee61e`, the worktree was clean and
`baseline_uncommitted` became historical, not an active blocker. Phase 25 then
completed a private Rust V2 receipt and a fixed-root Node verifier in
`0dc456e7` and `acdcb844`. The resulting status is deliberately split:

```text
privateEpsilonPlackettLuceDevelopmentBaseline = go
offlineTargetDistributionDevelopmentBaseline = go
developmentCandidatePolicy = eligible_pool_epsilon_plackett_luce_v1
developmentCandidateSelectionStatus = selected_for_future_authorization
developmentEvidenceStatus = verified_private_fixture_only
verifiableLoggingArtifactStatus = development_only_available
futureAuthorizationHandoff = selected_for_future_authorization
selectedMethod = diagnostics_only_abstention_v1
candidateQualificationStatus = not_run
runtimeActivationStatus = activation_not_authorized
```

The remaining `NO-GO` applies to a real randomized logger and runtime
activation, not to the committed development artifact. V2 now binds canonical
HKDF/ChaCha20/open53 draws, prefix conditionals, ordered joint/log-joint
propensity, source/config roots, and pre-RNG resource admission. Its commitment
purpose is explicitly development reveal consistency only: it does not prove
pre-commit timing, absence of seed grinding, epoch coverage completeness,
durable publication, or real utility safety. Decision Log remains default-off
and deterministic; the artifact remains private, synthetic and non-servable;
there is no production randomized-policy caller.

The next safe phase is privacy, retention, and capture-provenance readiness.
It may consume the private development evidence but cannot mint real propensity
or activation capability. No consumerless wrapper, qualification capability,
runtime activation, Phase 25 randomized shadow/online exploration, Promotion,
or Task 9 surface is authorized. The original audit follows unchanged for
traceability.

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
