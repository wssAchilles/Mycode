# Project Instructions

## Highest Principle

- Prioritize architecture, module boundaries, control planes, release safety, and production path integrity over broad test expansion.
- Keep tests "few but hard": focus only on high-leverage contract, regression, rollout, fallback, consistency, and critical-path verification.
- Do not spend large amounts of implementation budget on low-value, repetitive, or coverage-driven test files.
- When tradeoffs are required, prefer advancing the industrial-grade project skeleton and multi-language core path over adding more non-critical tests.

## Algorithm Research Gate

Apply this gate before planning or implementing changes to scorer, ranker, retrieval, policy, OPE, statistical inference, or other algorithm semantics. Research informs design but never replaces reading the repository.

1. Use codebase-memory first to confirm the current implementation, call graph, data contracts, canonical owner, default switches, fallback behavior, observability, and production boundaries.
2. Derive 3-5 explicit research questions from concrete code problems before searching for evidence. Do not choose an algorithm first and then search only for supporting material.
3. Prefer foundational and recent top-tier papers, public large-scale industrial practice, official technical reports, mature open-source implementations, and reproducible experiments.
4. For every source, record the exact title, authors, year, venue or institution, DOI or official link, and reading status (`full_text`, `abstract_or_public_description`, or `unverified`). Never invent papers, experimental results, online gains, or adoption claims.
5. Produce a concise evidence matrix covering the problem and core idea, required data/PIT/propensity/support assumptions, known limitations or failure cases, corresponding repository files and contracts, and the reason to adopt, adapt, or reject it.
6. Analyze at least one competing approach and state at least one reason not to adopt a method. Avoid confirmation bias.
7. Before adoption, check repository-specific feasibility: data scale and availability; PIT and immutable evidence; propensity and support; feature, label, and qHat availability; latency, CPU, memory, and storage cost; Rust/Node/C++/Go ownership; fallback, observability, rollback, and production authorization.
8. Convert accepted ideas into the smallest verifiable change: canonical owner, versioned contracts, offline/shadow validation, focused fixtures/baselines/ablations/tests, and explicit promotion, rollback, and fail-closed gates.
9. Report current code facts, research conclusions, accepted and rejected ideas, required plan corrections, and a `GO`, `CONDITIONAL GO`, or `NO-GO` verdict before implementation. Do not implement algorithm changes until the verdict and executable scope are established.
10. Keep research to roughly 20%-30% of the phase effort. Paper results are design evidence only; repository fixtures, baselines, ablations, performance tests, and shadow evidence must establish project results.

External research may be skipped for pure formatting, naming, mechanical migrations, narrow fixes governed by an existing contract, or tests/build repairs that do not change algorithm semantics. State the reason in one sentence when skipping it.

## Global commit message rules

For every repository and every git commit, always follow these rules unless the user explicitly asks otherwise.

### Commit message format

- Split every commit message into a title and a body.
- The title must be a single-line Conventional Commits style summary.
- The commit message title and body must be written in Chinese.
- Leave exactly one blank line between title and body.
- The body must use real newlines.
- Do not write literal `\n` inside commit messages.
- Use markdown bullet points like `- ` for body items.
- Keep the title concise and focused on what this commit accomplished.
- Prefer 2 to 4 bullet points in the body.
- Before creating a commit, verify the message would display cleanly on GitHub as a multi-line title + bullet list.

### Required output shape

type(scope): 中文标题

- 要点 1
- 要点 2

### Prohibited patterns

- Do not put multiple facts into a bloated title.
- Do not use literal `\n` as fake line breaks.
- Do not write the whole body as one long line.

### Incremental phase commits

- 完成每一小块的任务之后顺手进行commit提交，不要在工作区中留下大片的未提交内容。
- 阶段任务默认由 Codex 在 focused verification 通过后自行分块提交，无需等待额外批准；用户明确禁止提交时除外。
- 每次只暂存当前小块涉及的文件，保留工作树中既有或无关改动；不得因此自动 push、创建 PR 或提交他人改动。

## Anti-Flat Architecture Rule

For all future coding work, treat flat code organization as a hard anti-pattern unless the code is truly tiny and stable.

### Core rule

- Do not keep growing services, modules, or feature areas as a single flat directory full of peer files.
- Do not keep piling responsibilities into one large file, one large folder, or one pseudo-central module.
- As soon as a service or feature clearly contains multiple responsibilities, split it into domain-oriented subdirectories.
- Prefer layered or domain-driven structure over file-name-based organization.
- If a codebase is in transition, move it toward structured modules instead of extending the flat layout.

### Required coding behavior

- Before adding new files to an already-crowded directory, first ask whether the directory should be split.
- Group code by responsibility such as `adapters`, `core`, `domain`, `http`, `ingress`, `ops`, `realtime`, `sources`, `filters`, `scorers`, `selectors`, `side_effects`, `state`, `contracts`, `config`, or equivalent domain names.
- Keep orchestration, contracts, runtime state, transport adapters, business rules, and ops surfaces in separate modules.
- Prefer `mod.rs` plus subdirectories in Rust once a service grows beyond a handful of files.
- Prefer feature folders or bounded-context folders in TypeScript/JavaScript rather than wide flat service directories.
- When refactoring, prioritize improving module boundaries and folder structure before adding more feature code on top of a messy layout.

### Prohibited code-shape patterns

- Do not add more peer files into a flat `src/` directory when the service already spans multiple domains.
- Do not leave pipeline stages, adapters, ops handlers, state stores, and transport logic mixed together in the same folder without substructure.
- Do not use a single `pipeline`, `service`, `utils`, or `helpers` file as a dumping ground for unrelated behavior.
- Do not preserve flat structure just because it currently compiles.

### Default expectation for growing services

- Small bootstrap entrypoint in `main`
- Explicit `config` and `contracts`
- Separate domain folders for runtime behavior
- Separate ops/control-plane surface
- Separate adapters/integration layer
- Separate state/store layer when runtime state exists

### Enforcement priority

- When a tradeoff exists, prefer spending implementation effort on cleaner module and directory boundaries instead of extending a flat structure.
- If an existing area is visibly too flat, treat structural refactor as the correct next step before major feature expansion.
