# Project Instructions

## Highest Principle

- Prioritize architecture, module boundaries, control planes, release safety, and production path integrity over broad test expansion.
- Keep tests "few but hard": focus only on high-leverage contract, regression, rollout, fallback, consistency, and critical-path verification.
- Do not spend large amounts of implementation budget on low-value, repetitive, or coverage-driven test files.
- When tradeoffs are required, prefer advancing the industrial-grade project skeleton and multi-language core path over adding more non-critical tests.

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
