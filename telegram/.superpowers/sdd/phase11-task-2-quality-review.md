# Phase 11 Task 2 Code-Quality Review

## Verdict

`NEEDS_CHANGES`

## Scope

- `telegram-clone-backend/src/services/recommendation/promotion/evaluationProtocol/**`
- `telegram-clone-backend/tests/recommendation/phase11EvaluationProtocol.test.ts`
- Downstream binding edge inspected at `ope/inference/qualification/evaluate.ts:68-79`

## Findings

### P1 Important: caller-controlled accessors can rebind a trusted receipt to a different family

`verifyHoldoutUseLedgerV1` reads `input.family` independently when checking the private family capability (`ledger.ts:193`), verifying the complete registered stream (`ledger.ts:200`), and constructing the receipt family/holdout bindings (`ledger.ts:207-208`). Because the function accepts a runtime object and does not snapshot its properties, a Proxy/getter can return the registered fixture family for the first two reads and a different verified/adaptive family for the later receipt reads. The receipt still receives the private WeakSet brand and passes `isVerifiedHoldoutUseLedgerReceiptV1`, because `matchesRegisteredRoot` checks the raw/count/chain/manifest roots but not the receipt's family/holdout fields (`ledger.ts:405-421`). Downstream then trusts exactly those receipt fields when pairing it with a family (`ope/inference/qualification/evaluate.ts:76-79`), so this defeats the intended "adaptive family cannot reuse the registered ledger root" boundary.

Smallest fix: snapshot all four input properties once before validation and use only those locals through issuance; validate the snapshotted values rather than rereading `input`. Add one regression test using a getter/Proxy that changes `family` after the stream check and assert that no receipt is issued. As defense in depth, bind `familySha256` and `holdoutSha256` into the registered root comparison or persist the verified family locals in the receipt preimage.

Expected risk reduction: preserves the private receipt as a real capability and prevents cross-family/cross-holdout rebinding at the only issuance boundary.

### P2 Important: byte bounds are applied after copying the complete caller chunk

`BoundedLedgerReader.readChunk` calls `Buffer.from(next.value)` before it checks the aggregate byte limit (`ledger.ts:150-157`). A stream can therefore yield an arbitrarily large `Uint8Array` or string and force an equally large verifier-owned allocation before `resource_limit_exceeded` is returned, contradicting the bounded-reader contract. Empty chunks also return without advancing a byte, record, or chunk budget (`ledger.ts:153-154`), so an iterator that repeatedly yields empties can spin indefinitely without tripping a resource gate.

Smallest fix: calculate the incoming byte length first, reject it when it exceeds the remaining file budget, then copy only accepted chunks. Reject empty chunks as a canonical stream error, or add a small physical-chunk count limit. Add one focused oversized-chunk test and one empty-chunk failure test.

Expected risk reduction: makes the advertised memory/iterator boundary enforceable before allocation and prevents a broken producer from creating an unbounded verifier loop.

## Validated

- Normal path: exact registered synthetic stream produces an immutable, branded, permanently blocked receipt.
- Failure paths present in the focused suite: caller-resigned prefix, caller-supplied root, chain/digest/count drift, duplicate use/holdout, adaptive family root mismatch, noncanonical family, and production scope all fail closed.
- Integration edge: the qualification evaluator checks family and holdout equality against receipt fields, which is why the P1 rebinding path matters.
- Canonical record checks reject noncanonical JSON, CRLF/blank lines, missing final LF, extra records after `ledger_end`, invalid UTF-8, and line/record/file overflow in the ordinary bounded-chunk case by inspection.
- Digest preimages contain literal `contractVersion`/`recordType` fields, providing structural domain separation for family, record, manifest, root, and receipt hashes.

Focused verification run:

```text
npx vitest run tests/recommendation/phase11EvaluationProtocol.test.ts
PASS: 1 file, 4 tests
```

## Residual Risk And Follow-Up

- No production trust root exists, so current blast radius is synthetic/offline; P1 still blocks acceptance because the private brand is explicitly the trust boundary consumed by Task 3.
- The suite does not currently exercise changing accessors, oversized single chunks, empty-chunk iteration, malformed UTF-8, or explicit extra-record/truncation grammar. The first three directly cover the findings above; the latter two are lower-priority confidence gaps because the implementation visibly fails closed.
- Re-run this focused test and TypeScript `--noEmit` after the two fixes. No broad refactor is needed.
