# Phase 25 Verifiable Randomized Logging Contract

## Scope and verdict

This note answers four Phase 25 questions: how to make randomized logging
auditable, how to state without-replacement slate probabilities, how to keep
the evidence reproducible across runtimes, and how to reject unsafe work before
resource consumption.

The research verdict is **CONDITIONAL GO** for a development-only contract and
**NO-GO** for production randomized logging today.

The smallest viable V1 is an epoch seed commitment/reveal protocol, with
HKDF-SHA-256 domain separation and an RFC 8439 ChaCha20 byte stream. It retains
Rust as the canonical policy-arithmetic owner and makes TypeScript a strict
contract verifier. A VRF is a competing option when immediate public
verification is required, but it is not the V1 recommendation because it adds
cross-runtime implementation and key-management risk without removing the
need for policy, support, resource, and completeness receipts.

This document changes no algorithm or runtime. Production activation remains
blocked until all checks in the executable checklist are implemented, tested
against fixed vectors, shadowed, and authorized.

## Code-derived facts

The repository was inspected through codebase-memory before external research.

- `telegram-rust-workspace/crates/telegram-rust-recommendation/src/serving/policy/randomized_slate/mod.rs`
  owns the current private simulator. It accepts caller-supplied
  `uniformDraws`; it has no seed, PRNG algorithm identifier, commitment,
  proof, epoch, or domain-separation contract.
- The simulator sorts the remaining eligible candidates in a deterministic
  baseline order at every position, computes an epsilon/Plackett-Luce
  distribution, selects from one draw, and removes the selected candidate.
  It emits `probabilitySemantics=conditional_on_prior_slate_prefix_v1` and
  `withoutReplacement=true`.
- `telegram-rust-workspace/crates/telegram-randomized-policy-primitives/src/epsilon_plackett_luce.rs`
  owns the shared probability kernel. It uses max-shifted exponentials,
  rejects underflow and non-finite arithmetic, and requires both probability
  masses to be within `1e-12` of one.
- `telegram-rust-workspace/crates/telegram-recommendation-contracts/src/contracts/randomized_slate.rs`
  binds the source decision and candidate-pool SHA-256 digests, unique action
  identities, contiguous one-based positions, per-step conditional
  probabilities, and numerical diagnostics. Simulation evidence is explicitly
  `servable=false`.
- `telegram-clone-backend/src/services/recommendation/randomizedSlate/verify.ts`
  independently checks structure, digests, support counts, no duplicate
  selections, the epsilon-mixture identity, and probability-mass diagnostics.
  It does not regenerate draws or prove that a draw selected the logged action.
- `telegram-rust-workspace/crates/telegram-recommendation-contracts/src/contracts/decision_log.rs`
  permits `logged_randomized`, but its selected-action evidence carries only
  an ambiguously named `selectionProbability`; there is no explicit conditional
  versus marginal versus joint-slate discriminator.
- `telegram-rust-workspace/crates/telegram-recommendation-policy-offline/src/target_distribution/build.rs`
  already emits full per-prefix action distributions and removes each logged
  action before the next step. Its probability semantics are conditional on
  the prior slate prefix and its artifacts remain non-servable.
- Current randomized-slate limits are 2,048 source candidates and 64 slate
  positions. These are count caps, not a versioned preflight receipt. The raw
  JSON may be parsed and canonicalized before those caps are fully enforced.
- Inbound graph traces show the Rust `simulate` callers are tests. The
  TypeScript verifier feeds synthetic trajectory evidence. The live Decision
  Log builder is reachable from the feed path, but currently emits
  `deterministic_top_k`, not randomized logging.

## Research questions

1. Which deterministic random-bit contract can be unpredictable while an
   epoch is live, auditable after the epoch, and resistant to seed grinding or
   reuse across decisions and policy versions?
2. Which probability must be logged for ordered sampling without replacement,
   and how must conditional, joint, marginal, and inclusion probabilities be
   distinguished?
3. Which bytes, integer conversions, canonicalization rules, floating-point
   boundaries, versions, and fixtures must be frozen for Rust, TypeScript, Go,
   and C++ to reproduce the evidence?
4. Which input, work, allocation, deadline, and concurrency checks must pass
   before parsing, canonicalization, probability evaluation, or evidence
   emission?

## Evidence matrix

| Source and reading status | Evidence relevant to this repository | Limitation or failure case | Decision |
|---|---|---|---|
| Hugo Krawczyk, Pasi Eronen, **“HMAC-based Extract-and-Expand Key Derivation Function (HKDF)”**, 2010, IETF RFC 5869, DOI [10.17487/RFC5869](https://doi.org/10.17487/RFC5869), `full_text` | HKDF separates extraction from expansion; its `info` input binds derived key material to application and context identifiers and prevents reuse across contexts. The RFC includes fixed vectors. | HKDF does not itself prove that a seed existed before a decision, ensure unique decision context, or supply a random byte stream. | Adopt HKDF-SHA-256 with a fixed salt label and length-framed, versioned `info` tuple. |
| Yoav Nir, Adam Langley, **“ChaCha20 and Poly1305 for IETF Protocols”**, 2018, IRTF RFC 8439, DOI [10.17487/RFC8439](https://doi.org/10.17487/RFC8439), `full_text` | Specifies ChaCha20's key, nonce, counter, little-endian state, byte stream, and normative test vectors. A unique derived key per decision permits one fixed nonce under that key. | Reusing a `(key, nonce)` repeats the stream. Library RNG wrappers may use a different ChaCha round count, seeding transform, stream position, or output extraction. | Adopt the RFC 8439 block function directly as a versioned byte-stream contract; do not contract against a library RNG type. |
| John Kelsey, Shu-jen Chang, Ray Perlner, **“SHA-3 Derived Functions: cSHAKE, KMAC, TupleHash, and ParallelHash”**, 2016, NIST SP 800-185, DOI [10.6028/NIST.SP.800-185](https://doi.org/10.6028/NIST.SP.800-185), `full_text` | cSHAKE provides customization and TupleHash provides unambiguous tuple hashing; both are suitable alternatives when a SHA-3 primitive is already standardized across every runtime. | Adding a second hash family increases implementation surface in the current SHA-256-based repository. It still needs commitment timing and complete context binding. | Retain as a competing domain-separation design; reject for V1 simplicity. |
| Sharon Goldberg, Leonid Reyzin, Dimitrios Papadopoulos, Jan Vcelak, **“Verifiable Random Functions (VRFs)”**, 2023, IRTF RFC 9381, DOI [10.17487/RFC9381](https://doi.org/10.17487/RFC9381), `full_text` | A VRF lets the secret-key holder produce a unique pseudorandom output and proof that anyone with the public key can verify. The RFC defines ciphersuites, domain separators, security properties, and vectors. | VRF input is not secret; key validity, rotation, proof verification, ciphersuite availability, and cross-language vectors remain operational requirements. A VRF does not prove that all eligible decisions were logged. | Do not adopt for V1. Reconsider only if verification must occur before seed reveal or outside the trust domain. |
| Anders Rundgren, Bret Jordan, Samuel Erdtman, **“JSON Canonicalization Scheme (JCS)”**, 2020, RFC 8785, DOI [10.17487/RFC8785](https://doi.org/10.17487/RFC8785), `full_text` | Defines I-JSON restrictions, recursive property ordering, ECMAScript-compatible number serialization, and rejection of NaN, infinity, duplicate keys, and invalid Unicode for repeatable hashes. | Current repository `canonical_json` is a local contract. It must not be called JCS or silently changed unless every historical fixture and consumer migrates under a new version. | Freeze the current canonical format in V1 vectors; evaluate JCS only as an explicit future contract version. Use length framing for PRNG context instead of hashing ad hoc JSON. |
| IEEE, **“IEEE Standard for Floating-Point Arithmetic”**, 2019, IEEE 754-2019, DOI [10.1109/IEEESTD.2019.8766229](https://doi.org/10.1109/IEEESTD.2019.8766229), `abstract_or_public_description` | Standardizes binary64 representation and rounding for basic operations and documents reproducibility concerns. | Transcendental implementations such as `exp`, evaluation order, fused operations, and compiler modes can still produce runtime differences. Algebraic equivalence is not bitwise equivalence. | Require binary64, finite inputs, fixed operation order, no fast-math, and tolerance-based cross-runtime probability checks. Keep Rust as the bit-exact arithmetic owner. |
| Robin L. Plackett, **“The Analysis of Permutations”**, 1975, *Applied Statistics* 24(2):193-202, DOI [10.2307/2346567](https://doi.org/10.2307/2346567), `abstract_or_public_description` | The ranking likelihood is a product of successive choice probabilities over the remaining alternatives, matching the repository's remove-after-selection construction. | A Plackett-Luce likelihood alone does not define the repository's epsilon mixture, canonical tie break, support evidence, or logging audit. | Adopt successive conditional probability and joint-product semantics, with repository-specific mixture and ordering versions bound separately. |
| Adith Swaminathan, Akshay Krishnamurthy, Alekh Agarwal, Miroslav Dudík, John Langford, Damien Jose, Imed Zitouni, **“Off-policy Evaluation for Slate Recommendation”**, 2017, NeurIPS 30, [official full text](https://proceedings.neurips.cc/paper_files/paper/2017/file/5352696a9ca3397beb79f116f3a33991-Paper.pdf), `full_text` | Slate OPE requires an explicit logging distribution and structural assumptions; general slate estimators face unfavorable sample complexity. | Logging selected-action probabilities does not by itself establish the paper's response-model assumptions, overlap, reward contract, or estimator validity. | Use only to justify preserving full logging-policy/support evidence. Do not infer OPE readiness from the logging contract. |
| MITRE, **“CWE-400: Uncontrolled Resource Consumption”**, current official catalog, [official entry](https://cwe.mitre.org/data/definitions/400.html), `full_text` | Unbounded CPU, memory, or other consumption can cause denial of service and can trigger fail-open behavior; limits and throttling belong at architecture/design boundaries. | A count cap applied after parsing or allocation is not an admission-control boundary. | Adopt raw-byte, checked-work, allocation, deadline, and concurrency gates before expensive work; every failure is whole-decision fail-closed. |
| The Rust Project, **`Vec::try_with_capacity` / `try_reserve`**, current standard-library documentation, [official documentation](https://doc.rust-lang.org/stable/std/vec/struct.Vec.html), `full_text` | Fallible reservation reports capacity overflow or allocator failure instead of relying on infallible growth. | Fallible allocation is not a substitute for an authorized byte budget or checked size arithmetic. | Require checked arithmetic, a preflight budget, then fallible reservation in the Rust owner. |

## Recommended V1 random-bit protocol

### Trust and lifecycle

V1 is **post-epoch publicly auditable**, not immediately publicly verifiable.

1. Generate a 32-byte epoch seed from the operating-system CSPRNG.
2. Before the first eligible decision in the epoch, persist an append-only,
   signed commitment receipt containing the epoch ID, validity interval,
   algorithm suite, public policy/config digests, key/owner identity, previous
   receipt digest, and `seedCommitmentSha256`.
3. The commitment preimage is a length-framed tuple, not concatenated strings:

   ```text
   frame(x) = u32be(byte_length(x)) || x
   seedCommitmentSha256 = SHA256(
     frame("telegram/randomized-logging/seed-commit/v1") ||
     frame(epochIdUtf8) ||
     frame(epochSeed32)
   )
   ```

4. Close the epoch before reveal. Reveal the seed only after no new decision
   can use it. The verifier recomputes the commitment and rejects missing,
   late, overlapping, rewritten, or multiply revealed epochs.
5. Preserve a coverage ledger for every randomized-eligible decision. A valid
   PRNG proof for one record cannot prove that inconvenient decisions were not
   omitted.

Seed generation and commitment persistence are one control-plane operation.
If the commitment is not durably recorded before the epoch opens, randomized
logging does not start. A deterministic fallback may serve only with an
explicit deterministic policy kind and no fabricated randomized propensity.

### Per-decision domain separation

Derive one unique ChaCha20 key per decision:

```text
suiteId = "hkdf-sha256+rfc8439-chacha20+open53/v1"
salt = SHA256(frame("telegram/randomized-logging/hkdf-salt/v1"))
prk = HKDF-Extract-SHA256(salt, epochSeed32)
info = frame("telegram/randomized-slate/draw-key/v1") ||
       frame(suiteId) ||
       frame(epochId) ||
       frame(decisionId) ||
       frame(sourceDecisionLogSha256Raw32) ||
       frame(candidatePoolSha256Raw32) ||
       frame(policyConfigSha256Raw32)
decisionKey32 = HKDF-Expand-SHA256(prk, info, 32)
stream = RFC8439-ChaCha20(key=decisionKey32, nonce=12*0x00, counter=0)
```

All identifiers and digest decoding rules are part of the version. Duplicate
`(epochId, decisionId, sourceDecisionLogSha256, candidatePoolSha256,
policyConfigSha256)` contexts are rejected before generating bytes. Changing
the policy, pool, source decision, epoch, or suite necessarily changes the
derived key.

Do not use a global mutable RNG, wall-clock seed, request arrival order, UUID
library randomness, language hash, `rand_chacha` seed wrapper, or unspecified
`next_f64` helper as contract behavior.

### Exact open-interval draw mapping

The current contract requires each draw in `(0,1)`. Freeze this integer
mapping rather than a library float sampler:

1. Consume the next eight stream bytes as one little-endian `u64` word.
2. Set `r = word & ((1 << 53) - 1)`.
3. If `r == 0`, consume another word. Permit at most four words for a single
   position; exhausting the retry budget fails the whole decision closed.
4. Set `u = r * 2^-53`. This conversion is exact in binary64 and yields
   `0 < u < 1`.
5. Record `position`, the zero-based stream word index, retry count, and `r`
   as a decimal string. `uniformDraw` may remain a derived compatibility
   field but is never the canonical random evidence.

This mapping makes the byte-to-draw step bit-reproducible. It does not by
itself make `exp` or cumulative floating-point sums bit-reproducible across
languages; those are governed separately below.

## Without-replacement probability contract

For eligible support `S_1`, ordered selected actions `(a_1,...,a_k)`, and
prefix `h_{j-1}=(a_1,...,a_{j-1})`:

```text
S_j = S_1 minus {a_1,...,a_{j-1}}
t_j = first action in the versioned deterministic baseline order over S_j
q_j(a | h_{j-1}) = exp((score(a)-maxScore_j)/temperature) /
                    sum_{b in S_j} exp((score(b)-maxScore_j)/temperature)
p_j(a | h_{j-1}) = (1-epsilon) * 1[a=t_j] + epsilon * q_j(a | h_{j-1})
P_slate(a_1,...,a_k) = product_{j=1..k} p_j(a_j | h_{j-1})
log P_slate = sum_{j=1..k} log p_j(a_j | h_{j-1})
```

The contract must use these names precisely:

- `conditionalSelectionProbability`: `p_j` for the selected action after the
  exact prior prefix; this is the behavior propensity consumed at that step.
- `jointSlateProbability` or `jointSlateLogProbability`: the ordered-slate
  product or log-sum. The log form is canonical when the product underflows.
- `positionMarginalProbability`: probability that an action appears at one
  position after integrating over all earlier prefixes. V1 does not compute it.
- `inclusionProbability`: probability that an action appears anywhere in the
  slate. V1 does not compute it.

Conditional probabilities must never be relabeled as position marginals or
inclusion probabilities. Multiplying per-position marginals is not the slate
propensity. An unordered set propensity is also not the ordered-slate
propensity.

### Required per-decision evidence

The randomized decision receipt must bind:

- contract, position, probability-semantics, baseline-order, policy-arithmetic,
  PRNG-suite, and canonicalization versions;
- request and decision identities, serving owner, decision time, epoch ID,
  commitment receipt digest, and reveal status;
- policy/config digest, epsilon, temperature, slate size, model/artifact/index
  versions, source decision digest, and complete candidate-pool digest;
- complete/non-truncated support evidence, total and eligible counts, unique
  candidate identities, finite scores, eligibility reasons, and deterministic
  tie-breaking fields;
- for every position: prefix digest, remaining-support digest/count, selected
  action key, deterministic-top action key, raw `r`, stream word index,
  Plackett-Luce probability, conditional selection probability, selected
  cumulative interval, and full-distribution digest;
- `jointSlateLogProbability`, numerical mass diagnostics, resource-preflight
  digest, output digest, and whole-decision status.

The selected interval must be computed from the same ordered distribution
used for logging. The selected action must be the unique interval containing
the exact draw. The final interval closes at one to absorb only accumulated
rounding; it must not mask a probability-mass failure above `1e-12`.

Any incomplete support, truncation, duplicate identity, non-finite value,
probability underflow, mass mismatch, missing prefix, action repetition,
digest drift, draw mismatch, or evidence write failure invalidates the entire
randomized decision. Partial propensity evidence must not escape.

## Cross-language reproducibility boundary

Reproducibility has two levels and the contract must not conflate them.

### Bit-exact across all participating runtimes

- length framing, UTF-8 validity, digest hex decoding, and all domain labels;
- SHA-256, HKDF-SHA-256, RFC 8439 ChaCha20 bytes, counters, nonce, and little-
  endian word extraction;
- the open-53 mapping, retry positions, integer draw transcript, candidate
  identity/order fixtures, and artifact digests;
- current canonical JSON bytes, until an explicitly versioned migration occurs.

### Canonical-owner exact, verifier semantic

- exponentials, division, epsilon mixing, cumulative sums, `log`, and mass
  diagnostics are bit-exact only in the Rust canonical owner;
- TypeScript and any Go/C++ verifier use finite checks, the same evaluation
  order, and declared tolerances. They do not mint replacement canonical
  probabilities or hashes from locally recomputed transcendental results;
- compilation uses binary64 and disables fast-math/reassociation. Negative
  zero, NaN, infinities, subnormal handling, and last-interval closure have
  fixed fixtures.

Every participating runtime must pass the same immutable fixture manifest:

1. RFC 5869 and RFC 8439 normative vectors.
2. One repository epoch commitment/reveal vector.
3. Domain-separation vectors where changing each tuple field changes the key.
4. Duplicate-context rejection and wrong-seed/wrong-commitment vectors.
5. Draw vectors covering `r=0` retry, minimum `r=1`, maximum
   `r=2^53-1`, multi-block stream traversal, and retry-budget exhaustion.
6. Slate vectors covering ties, input permutation, `epsilon=1`, very small
   positive epsilon, one remaining action, near cumulative boundaries,
   non-finite/underflow rejection, and joint log propensity.
7. Canonical JSON edge vectors from RFC 8785 plus repository-local wire
   vectors, explicitly labeled as different contracts if their bytes differ.
8. A manifest digest over input bytes and expected bytes, checked in Rust,
   TypeScript, Go, and C++ CI wherever that runtime consumes the contract.

## Resource preflight contract

Let `n` be source candidate count, `e` eligible count, and `k` slate size.
For the current successive distribution construction, the exact number of
candidate probability evaluations is:

```text
A(e,k) = sum_{j=0..k-1}(e-j) = k*e - k*(k-1)/2
```

For a full target-distribution artifact, `A(e,k)` is also the exact maximum
number of action-probability records. The current implementation re-sorts
remaining support each step, so preflight must additionally charge versioned
sort work, or the implementation must be changed to preserve one canonical
order after a single sort. Resource formulas are contract versions, not
informal estimates.

Admission order is mandatory:

1. At the transport boundary, reject compressed and decompressed byte sizes,
   nesting depth, array lengths, string lengths, duplicate keys, and invalid
   UTF-8 before materializing the full object.
2. Read only bounded header/count fields. Require `1 <= k <= 64`,
   `k <= e <= n <= 2048`, complete support, and non-truncation.
3. Use checked integer arithmetic for `A(e,k)`, canonical-input bytes,
   projected output records/bytes, sort work, hash bytes, PRNG words, and
   verification work. Overflow is a blocker.
4. Bind an immutable resource receipt containing the formula version, observed
   counts/bytes, every projected unit, configured maxima, deadline, concurrency
   class, and receipt digest. Every observed/projected value must be at or
   below its independently configured maximum.
5. Acquire concurrency and memory permits before canonicalization, hashing,
   sorting, or crypto proof work. Recheck deadline/cancellation after each
   position and before durable emission.
6. In Rust, reserve from the approved byte/count plan with fallible
   `try_reserve`/`try_with_capacity`. Allocation failure is a whole-decision
   blocker, not a deterministic fallback carrying randomized evidence.
7. Write evidence atomically: temporary/spooled bytes, digest verification,
   durable commit, then publication. Partial records are quarantined and not
   OPE-eligible.

Required stable blockers include at least:

```text
raw_input_bytes_exceeded
decoded_input_bytes_exceeded
json_depth_exceeded
candidate_pool_too_large
slate_too_large
insufficient_eligible_candidates
resource_arithmetic_overflow
probability_work_exceeded
sort_work_exceeded
canonical_bytes_exceeded
output_records_exceeded
output_bytes_exceeded
prng_retry_budget_exceeded
memory_permit_unavailable
allocation_failed
deadline_exceeded
cancelled
evidence_commit_failed
```

Counts alone are insufficient: 2,048 adversarially long candidate IDs can
exhaust canonical bytes, and a valid-sized decision can still exceed available
concurrency or deadline budgets.

## Executable contract checklist

### Control plane and cryptography

- [ ] A versioned algorithm suite names SHA-256, HKDF-SHA-256, RFC 8439
  ChaCha20, framing, byte order, nonce, counter, and open-53 mapping.
- [ ] A 32-byte OS-random seed is committed in a signed append-only receipt
  before the epoch opens; epochs do not overlap and form a digest chain.
- [ ] Reveal occurs only after epoch closure; commitment, timing, ownership,
  and previous-receipt digest verify.
- [ ] Decision contexts are unique and bind epoch, decision, source decision,
  candidate pool, policy config, and suite. Duplicate use fails closed.
- [ ] Coverage accounting proves every randomized-eligible decision has one
  randomized receipt or one explicit blocker receipt.
- [ ] Seed access, rotation, reveal, retention, and incident rollback have
  named owners and are independent of the serving request path.

### Sampling and probability

- [ ] Full eligible support is complete, non-truncated, identity-unique,
  digest-bound, and large enough for the slate before random bytes are used.
- [ ] Baseline order and tie breaks are versioned and invariant to input order.
- [ ] Each step recomputes over exactly the remaining support and removes the
  selected identity once.
- [ ] Every distribution is finite, positive on eligible support, and within
  the fixed mass tolerance; underflow is a blocker.
- [ ] The draw transcript regenerates from the revealed seed and selects the
  logged action from its logged interval.
- [ ] Selected conditional propensity is computed before outcome observation
  and before any post-selection mutation.
- [ ] Conditional, joint-slate, position-marginal, and inclusion probability
  fields are distinct; absent marginals are explicitly absent.
- [ ] Joint log propensity equals the ordered sum of conditional log
  propensities under one prefix contract.

### Cross-runtime evidence

- [ ] Rust is the canonical policy-arithmetic and evidence owner; verifiers
  cannot mint canonical probability artifacts.
- [ ] Rust and TypeScript pass all normative and repository vectors; Go/C++
  must pass them before consuming or producing this contract.
- [ ] Canonical byte/hash vectors cover numeric and Unicode edges. Local
  canonical JSON is not mislabeled as RFC 8785 JCS.
- [ ] All floating operations use binary64, fixed order, no fast-math, finite
  checks, fixed tolerance, and last-interval rules.
- [ ] Fixture manifests bind source bytes, expected bytes, toolchain versions,
  algorithm versions, and a top-level SHA-256 digest.

### Resource and release gates

- [ ] Raw and decoded byte limits run before full JSON parsing.
- [ ] Checked `A(e,k)` and versioned sort/hash/output/PRNG work estimates fit
  configured budgets before allocation.
- [ ] Memory and concurrency permits are acquired; Rust allocations are
  fallible and bounded by the receipt.
- [ ] Cancellation/deadline checks cannot emit partial propensity evidence.
- [ ] Blocker literals and precedence are stable in Rust and TypeScript.
- [ ] Offline replay verifies commitment/reveal, coverage, draws, selections,
  propensities, joint log propensity, resources, and artifact digests.
- [ ] Shadow evidence demonstrates zero unexplained coverage gaps, zero digest
  drift, zero cross-runtime vector drift, bounded resource use, and declared
  latency before any promotion request.
- [ ] Rollback disables randomized eligibility and emits deterministic policy
  evidence; it never silently reuses a seed or relabels fallback traffic.

## Accepted and rejected approaches

| Approach | Decision | Reason |
|---|---|---|
| Epoch commitment/reveal + HKDF-SHA-256 + RFC 8439 ChaCha20 | Adopt for development V1 | Uses mature cross-language primitives, prevents per-request seed grinding when commitment timing and coverage are enforced, and is replayable after reveal. |
| RFC 9381 VRF per decision | Defer | Strong immediate public verification and uniqueness, but larger implementation/key surface; it does not solve coverage, probability semantics, or resources. |
| NIST cSHAKE/TupleHash stream | Reject for V1, retain alternative | Excellent native customization/tuple semantics, but introduces a new hash family while current evidence is SHA-256-based. |
| Generic language/library seeded RNG | Reject | Algorithm, rounds, seeding transform, float mapping, stream position, and stability are usually not a public cross-language contract. |
| Caller-provided `uniformDraws` | Reject for logging | Replays a claimed draw but provides no unpredictability, precommitment, domain separation, or proof that the logger did not choose it after seeing the decision. |
| Public deterministic hash of request fields | Reject | Auditable but predictable and grindable by callers or upstream systems; it is not a valid live randomized logging policy. |
| Log only selected-action probability | Reject as sufficient evidence | Does not prove the random draw, prefix support, selected interval, full distribution, joint slate probability, commitment timing, or coverage completeness. |
| Bit-exact cross-language transcendental recomputation | Reject | IEEE binary64 does not make all `exp`/`log` implementations and compiler evaluation orders identical. Canonical ownership plus semantic verification is narrower and testable. |

## Plan corrections and promotion boundary

Phase 25 should not replace the current `uniformDraws` field with a bare seed
or turn simulated propensity into servable evidence. The executable sequence is:

1. Add versioned commitment, PRNG transcript, probability semantics, resource
   receipt, and coverage contracts under the existing contract ownership
   boundary.
2. Implement the random-bit primitive once in a small Rust owner; add a strict
   TypeScript verifier and immutable cross-runtime fixtures.
3. Keep policy arithmetic in the existing shared Rust primitive. Do not copy
   the probability kernel into each runtime.
4. Produce development-only replay and shadow evidence with
   `servable=false` and no Promotion caller.
5. Request a separate authorization only after shadow, rollback, key/seed
   operations, resource budgets, and coverage audits pass.

Current production randomized logging, OPE readiness, and Promotion remain
**NO-GO**. The contract design and development fixtures are **CONDITIONAL GO**
subject to the checklist above.
