# Phase 11 Synthetic Behavior Fixture Report

## Outcome

- Added `phase11_synthetic_behavior_trajectory_v1.json` under the existing randomized-slate fixture domain; manifest domain count remains 9.
- The private Rust kernel generated the complete expected simulation for draws `[0.5, 0.5]`, epsilon `0.3`, temperature `1.0`, and slate size `2`.
- Selected trajectory is `507f191e810c19729de8c001@1` then `507f191e810c19729de8c002@2`, exactly matching the target fixture source Decision Log actions.
- Behavior config digest is `55905b22e6b2775a1defb0f0ada17a9cecb9ed9b01436b2e4322b19b292e7299`; target config digest is `b5733bd95b7db416eb2371f29e56285f7b48453fc454c98e0150982a3604a800`.
- Output remains `evidenceKind: simulated_propensity` and `servable: false`; no runtime export or `logged_randomized` evidence was added.

## Contract Boundaries

- `telegram-rust-recommendation` golden test directly invokes the private `simulate` kernel and compares the complete output.
- `telegram-recommendation-fixtures` only deserializes and validates digests, source/candidate-pool equality, target action-prefix equality, manifest membership, and non-servable simulated evidence.
- No kernel re-export, Node edit, production caller, or runtime path was introduced.

## Verification

- `cargo test -p telegram-rust-recommendation serving::policy::randomized_slate::tests`: 11 passed.
- `cargo test -p telegram-recommendation-fixtures --test cross_runtime_contract`: 12 passed.
- `cargo fmt --check -p telegram-rust-recommendation -p telegram-recommendation-fixtures`: passed.
- Scoped `git diff --check`: passed; all owned Rust surfaces are inherited untracked files.
- `git diff --no-index --check` reported no whitespace errors for each owned file (exit `1` is the expected content-difference status).

## Review

- Specification review: all assigned trajectory, digest-separation, private-kernel, manifest-count, and evidence-isolation requirements are covered.
- Quality review: strict Serde envelopes, existing canonical digest helpers, and one relationship-focused test were reused; the temporary generator was removed.
- Commit remains blocked because all three pre-existing Rust surfaces are untracked Phase 1-10 files in the inherited dirty tree.
