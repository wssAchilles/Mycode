import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
    access,
    link,
    readFile,
    stat,
    unlink,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import {
    canonicalDigest,
    validateEmbeddingRepairProposal,
} from '../services/ops/recommendation/embeddingRepair/artifacts';
import type {
    EmbeddingContractRepairProposal,
} from '../services/ops/recommendation/embeddingRepair/contracts';
import {
    isFullEmbeddingEvidenceSummary,
} from '../services/ops/recommendation/embeddingEvidenceAudit';
import {
    resolveEmbeddingAuditExitCode,
} from './auditEmbeddingContracts';
import {
    validateRecommendationAuditEvidence,
} from '../services/ops/recommendation/auditMongoAccess';

export const TASK8_NODE_GATE_TEST_FILES = [
    'tests/recommendation/userEmbeddingQueryHydrator.test.ts',
    'tests/recommendation/registeredUserFeatureBootstrap.test.ts',
    'tests/recommendation/embeddingProvenance.test.ts',
    'tests/recommendation/newsAnnSource.test.ts',
    'tests/recommendation/denseEmbedding.test.ts',
    'tests/recommendation/embeddingRetrievalPolicy.test.ts',
    'tests/recommendation/embeddingContractEvidence.test.ts',
    'tests/config/db.test.ts',
    'tests/recommendation/auditMongoAccess.test.ts',
    'tests/recommendation/embeddingEvidenceAudit.test.ts',
    'tests/recommendation/embeddingRepairArtifacts.test.ts',
    'tests/recommendation/embeddingRepairPlannerTransaction.test.ts',
    'tests/scripts/auditEmbeddingContracts.test.ts',
    'tests/scripts/auditDailyRecommendationRefresh.test.ts',
    'tests/recommendation/dailyRefreshOps.test.ts',
    'tests/recommendation/dailyRecommendationRefreshJob.test.ts',
    'tests/scripts/backfillEmbeddingContracts.test.ts',
    'tests/ops/recommendationOpsReadiness.test.ts',
] as const;

const CANONICAL_RELEASE_SCRIPT = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    '',
    'ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"',
    ': "${APPROVED_EMBEDDING_QUARANTINE_DIGEST:?Set an independently approved quarantine digest}"',
    '',
    'if [[ ! "$APPROVED_EMBEDDING_QUARANTINE_DIGEST" =~ ^[0-9a-f]{64}$ ]]; then',
    '  echo "APPROVED_EMBEDDING_QUARANTINE_DIGEST must be lowercase 64-hex" >&2',
    '  exit 64',
    'fi',
    '',
    'bash "$ROOT_DIR/tools/release/verify_cpp.sh"',
    'bash "$ROOT_DIR/tools/release/verify_go.sh"',
    'npm --prefix "$ROOT_DIR/telegram-clone-backend" test -- \\',
    ...TASK8_NODE_GATE_TEST_FILES.map((testFile, index) => (
        `  ${testFile}${index === TASK8_NODE_GATE_TEST_FILES.length - 1 ? '' : ' \\'}`
    )),
    'cargo test \\',
    '  --manifest-path "$ROOT_DIR/telegram-rust-workspace/Cargo.toml" \\',
    '  -p telegram-rust-recommendation replay',
    'npm --prefix "$ROOT_DIR/telegram-clone-backend" run audit:embedding-contracts -- \\',
    '  --strict \\',
    '  --approved-quarantine-digest "$APPROVED_EMBEDDING_QUARANTINE_DIGEST"',
    '',
].join('\n');

export const TASK4_FOCUSED_VITEST_COMMAND =
    '(cd telegram-clone-backend && ./node_modules/.bin/vitest run tests/recommendation/userEmbeddingQueryHydrator.test.ts tests/recommendation/embeddingProvenance.test.ts tests/recommendation/newsAnnSource.test.ts tests/recommendation/denseEmbedding.test.ts tests/recommendation/embeddingRetrievalPolicy.test.ts)';
export const TASK8_NODE_GATE_COMMAND =
    `(cd telegram-clone-backend && ./node_modules/.bin/vitest run ${TASK8_NODE_GATE_TEST_FILES.join(' ')})`;
export const TASK8_PACKET_RENDERER_VITEST_COMMAND =
    '(cd telegram-clone-backend && ./node_modules/.bin/vitest run tests/scripts/renderEmbeddingRemediationAuthorizationPacket.test.ts)';
export const BACKEND_TSC_COMMAND =
    './telegram-clone-backend/node_modules/.bin/tsc --noEmit -p telegram-clone-backend/tsconfig.json --pretty false';
export const RELEASE_SHELL_SYNTAX_COMMAND = 'bash -n tools/release/verify_all.sh';
export const RELEASE_FORBIDDEN_SCAN_PATTERN =
    '--limit|verify_performance\\.sh|(^|\\s|/)python([0-9]+(\\.[0-9]+)*)?(\\s|$)|pytest|ml-services';
export const RELEASE_FORBIDDEN_SCAN_COMMAND =
    `if rg -n -- '${RELEASE_FORBIDDEN_SCAN_PATTERN}' tools/release/verify_all.sh; then exit 1; fi`;
export const DIFF_CHECK_COMMAND = 'git diff --check';

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const GIT_SHA_PATTERN = /^[a-f0-9]{40,64}$/;
const TASKS = [4, 5, 6, 7, 8] as const;
const CHECK_FIELDS = [
    'task4FocusedVitest',
    'packetRendererVitest',
    'backendTsc',
    'releaseShellSyntax',
    'releaseForbiddenScan',
    'diffCheck',
] as const;
const CHECK_COMMANDS: Record<(typeof CHECK_FIELDS)[number], string> = {
    task4FocusedVitest: TASK4_FOCUSED_VITEST_COMMAND,
    packetRendererVitest: TASK8_PACKET_RENDERER_VITEST_COMMAND,
    backendTsc: BACKEND_TSC_COMMAND,
    releaseShellSyntax: RELEASE_SHELL_SYNTAX_COMMAND,
    releaseForbiddenScan: RELEASE_FORBIDDEN_SCAN_COMMAND,
    diffCheck: DIFF_CHECK_COMMAND,
};
const REQUIRED_ROLES: Record<4 | 5 | 6 | 7 | 8, readonly string[]> = {
    4: ['implementer', 'spec_reviewer', 'quality_reviewer'],
    5: ['implementer', 'spec_reviewer', 'quality_reviewer'],
    6: ['implementer', 'spec_reviewer', 'quality_reviewer'],
    7: ['implementer', 'spec_reviewer', 'quality_reviewer'],
    8: ['implementer', 'spec_reviewer', 'quality_reviewer', 'proposal_reviewer', 'final_reviewer'],
};
const INDEPENDENT_ROLES = new Set([
    'implementer',
    'spec_reviewer',
    'quality_reviewer',
    'proposal_reviewer',
    'final_reviewer',
]);

export interface EmbeddingRemediationCodeState {
    gitSha: string;
    branch: string;
    worktreeStatus: string;
    trackedDiffRaw: Buffer;
    untracked: Array<{ path: string; raw: Buffer }>;
}

export interface EmbeddingRemediationAuthorizationPacketRawInput extends EmbeddingRemediationCodeState {
    proposalRaw: Buffer;
    deterministicChecksRaw: Buffer;
    dispatchEvidenceRaw: Buffer;
    proposalReviewRaw: Buffer;
    operatorEvidencePath: string;
    operatorEvidenceRaw: Buffer;
    releaseScriptRaw: Buffer;
    baselineJsonRaw?: Buffer;
    baselineStderrRaw?: Buffer;
    baselineExitRaw?: Buffer;
}

interface CheckResult {
    command: string;
    exit: 0;
    finishedAt: string;
}

interface DeterministicChecks {
    schemaVersion: 1;
    codeStateDigest: string;
    nodeGate: CheckResult & { testFiles: string[] };
    task4FocusedVitest: CheckResult;
    packetRendererVitest: CheckResult;
    backendTsc: CheckResult;
    releaseShellSyntax: CheckResult;
    releaseForbiddenScan: CheckResult;
    diffCheck: CheckResult;
    mlServicesDiffLines: [];
    mlServicesStatusLines: [];
    releaseScriptSha256: string;
}

interface ProposalReview {
    schemaVersion: 1;
    decision: 'APPROVED_FOR_AUTHORIZATION_REQUEST';
    productionAuthorization: 'NOT_GRANTED';
    reviewer: {
        agentId: string;
        model: 'gpt-5.6-sol';
        reasoningEffort: 'ultra';
    };
    reviewedAt: string;
    proposalFileSha256: string;
    proposalDigest: string;
    quarantineDigest: string;
    corpusStateDigest: string;
    fullScan: true;
    codeStateDigest: string;
}

interface DispatchEvidence {
    schemaVersion: 1;
    codeStateDigest: string;
    dispatches: Array<{
        task: 4 | 5 | 6 | 7 | 8;
        role: string;
        agentId: string;
        model: 'gpt-5.6-sol';
        reasoningEffort: 'ultra';
        status: 'DONE';
        finishedAt: string;
    }>;
}

interface BaselineEvidence {
    exit: '0' | '2';
    jsonSha256: string;
    stderrSha256: string;
    exitSha256: string;
}

interface RenderedArtifacts {
    proposal: EmbeddingContractRepairProposal;
    checks: DeterministicChecks;
    review: ProposalReview;
    dispatch: DispatchEvidence;
    codeStateDigest: string;
    baseline: BaselineEvidence | null;
}

interface CliOptions {
    repoRoot: string;
    artifactsDir: string;
    operatorEvidenceFile: string;
    releaseScript: string;
    packetOutput: string;
    checksumsOutput: string;
}

export interface AuthorizationPacketCliDependencies {
    readFile: typeof readFile;
    writeFile: typeof writeFile;
    link: typeof link;
    stat: typeof stat;
    unlink: typeof unlink;
    fileExists: (filePath: string) => Promise<boolean>;
    loadCodeState: () => Promise<EmbeddingRemediationCodeState>;
    writeError: (message: string) => void;
}

export function computeEmbeddingRemediationCodeStateDigest(
    input: EmbeddingRemediationCodeState,
): string {
    if (!GIT_SHA_PATTERN.test(input.gitSha)
        || !isSafeText(input.branch)
        || typeof input.worktreeStatus !== 'string'
        || !Buffer.isBuffer(input.trackedDiffRaw)
        || !Array.isArray(input.untracked)) {
        throw new Error('embedding_authorization_code_state_invalid');
    }
    const seen = new Set<string>();
    const untracked = input.untracked.map((entry) => {
        if (!entry || !isSafeText(entry.path) || !Buffer.isBuffer(entry.raw) || seen.has(entry.path)) {
            throw new Error('embedding_authorization_code_state_invalid');
        }
        seen.add(entry.path);
        return { path: entry.path, sha256: sha256(entry.raw) };
    }).sort((left, right) => compareUtf8(left.path, right.path));

    return canonicalDigest({
        schemaVersion: 1,
        gitSha: input.gitSha,
        branch: input.branch,
        worktreeStatus: input.worktreeStatus,
        trackedDiffSha256: sha256(input.trackedDiffRaw),
        untracked,
    });
}

export function renderEmbeddingRemediationAuthorizationPacket(
    input: EmbeddingRemediationAuthorizationPacketRawInput,
    now: Date | number = Date.now(),
): string {
    const artifacts = validateArtifacts(input, now);
    const proposal = artifacts.proposal;
    const baseline = artifacts.baseline;
    const worktreeStatus = input.worktreeStatus.trim() || '(clean)';
    const untracked = input.untracked.length === 0
        ? '- none'
        : input.untracked
            .slice()
            .sort((left, right) => compareUtf8(left.path, right.path))
            .map((entry) => `- ${entry.path}: ${sha256(entry.raw)}`)
            .join('\n');

    return `# Recommendation Embedding Contract Remediation Authorization Packet

## Decision Boundary

- Readiness: CODE_AND_DRY_RUN_READY
- Production authorization: NOT GRANTED
- Task 9: UNAUTHORIZED
- Phase 0.5 gate complete: NO

## Repository Code State

- Git SHA: ${input.gitSha}
- Branch: ${input.branch}
- Code state digest: ${artifacts.codeStateDigest}
- Tracked diff SHA-256: ${sha256(input.trackedDiffRaw)}
- Worktree status:

\`\`\`text
${worktreeStatus}
\`\`\`

### Untracked Code Inputs

${untracked}

## Deterministic Checks

\`\`\`json
${JSON.stringify(artifacts.checks, null, 2)}
\`\`\`

## Full Dry-Run Proposal

- Proposal file SHA-256: ${sha256(input.proposalRaw)}
- Proposal digest: ${proposal.proposalDigest}
- Quarantine digest: ${proposal.quarantineDigest}
- Corpus state digest: ${proposal.corpusStateDigest}
- Full scan: ${proposal.fullScan}
- Users scanned: ${proposal.scanned.users}
- Post snapshots scanned: ${proposal.scanned.postFeatureSnapshots}
- User replay matched: ${proposal.replay.user.matched}
- User replay mismatched: ${proposal.replay.user.mismatched}
- User replay input missing: ${proposal.replay.user.inputMissing}
- Post replay matched: ${proposal.replay.post.matched}
- Post replay mismatched: ${proposal.replay.post.mismatched}
- Mongo writes: ${proposal.writeCounters.mongo}
- Redis writes: ${proposal.writeCounters.redis}
- Scheduler changes: ${proposal.writeCounters.scheduler}
- Process changes: ${proposal.writeCounters.process}
- Python operations: ${proposal.writeCounters.python}

## Read-Only Operator Evidence

- Evidence file: ${input.operatorEvidencePath}
- Evidence file SHA-256: ${sha256(input.operatorEvidenceRaw)}
- Meaning: operator-reviewed proof input; not production authorization.
- URI digest equality remains enforced only by the live audit connection; this packet never receives the Mongo URI.

## Independent Proposal Review

\`\`\`json
${JSON.stringify(artifacts.review, null, 2)}
\`\`\`

## Agent Dispatch Evidence

\`\`\`json
${JSON.stringify(artifacts.dispatch, null, 2)}
\`\`\`

## Optional Pre-Apply Baseline

- Exit: ${baseline?.exit ?? 'NOT_RUN'}
- JSON SHA-256: ${baseline?.jsonSha256 ?? 'NOT_RUN'}
- stderr SHA-256: ${baseline?.stderrSha256 ?? 'NOT_RUN'}
- exit SHA-256: ${baseline?.exitSha256 ?? 'NOT_RUN'}

## Explicitly Not Authorized

- MongoDB mutation
- Redis mutation
- Scheduler mutation
- Process restart
- Apply or rollback execution
- Python source, test, writer, or runtime changes
`;
}

export async function runEmbeddingRemediationAuthorizationPacketCli(
    argv: readonly string[],
    dependencyOverrides: Partial<AuthorizationPacketCliDependencies> = {},
): Promise<0 | 3> {
    let dependencies: AuthorizationPacketCliDependencies | undefined;
    let invocationLock: OwnedPath | undefined;
    try {
        const options = parseArgs(argv);
        dependencies = {
            readFile,
            writeFile,
            link,
            stat,
            unlink,
            fileExists,
            loadCodeState: () => loadGitCodeState(options.repoRoot),
            writeError: (message) => console.error(message),
            ...dependencyOverrides,
        };
        assertOutputPaths(options);
        invocationLock = await acquireInvocationLock(options.packetOutput, dependencies);
        if (await dependencies.fileExists(options.packetOutput)
            || await dependencies.fileExists(options.checksumsOutput)) {
            throw new Error('embedding_authorization_output_exists');
        }
        const input = await loadAuthorizationPacketInput(options, dependencies);
        const packet = renderEmbeddingRemediationAuthorizationPacket(input);
        const checksums = renderChecksums(input, Buffer.from(packet), options);
        const refreshedInput = await loadAuthorizationPacketInput(options, dependencies);
        if (computeInputSnapshotDigest(refreshedInput) !== computeInputSnapshotDigest(input)) {
            throw new Error('embedding_authorization_input_drift');
        }
        await publishOutputs(options, packet, checksums, dependencies);
        return 0;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        (dependencies?.writeError ?? dependencyOverrides.writeError ?? console.error)(
            `[RenderEmbeddingRemediationAuthorizationPacket] failed: ${message}`,
        );
        return 3;
    } finally {
        if (dependencies && invocationLock) {
            await safeUnlinkCreatedPath(invocationLock.path, invocationLock.identity, dependencies);
        }
    }
}

function validateArtifacts(
    input: EmbeddingRemediationAuthorizationPacketRawInput,
    now: Date | number = Date.now(),
): RenderedArtifacts {
    if (!Buffer.isBuffer(input.proposalRaw)
        || !Buffer.isBuffer(input.deterministicChecksRaw)
        || !Buffer.isBuffer(input.dispatchEvidenceRaw)
        || !Buffer.isBuffer(input.proposalReviewRaw)
        || !Buffer.isBuffer(input.operatorEvidenceRaw)
        || !Buffer.isBuffer(input.releaseScriptRaw)
        || !isSafeText(input.operatorEvidencePath)) {
        throw new Error('embedding_authorization_input_invalid');
    }
    const codeStateDigest = computeEmbeddingRemediationCodeStateDigest(input);
    const operatorEvidence = validateRecommendationAuditEvidence(input.operatorEvidenceRaw, now);
    const nowMs = now instanceof Date ? now.getTime() : now;
    const proposal = validateEmbeddingRepairProposal(
        parseJson(input.proposalRaw, 'embedding_authorization_proposal_json_invalid'),
        { forApply: true },
    );
    const checks = validateChecks(
        parseJson(input.deterministicChecksRaw, 'embedding_authorization_checks_json_invalid'),
        codeStateDigest,
        input.releaseScriptRaw,
        Date.parse(operatorEvidence.reviewedAt),
        nowMs,
    );
    const review = validateReview(
        parseJson(input.proposalReviewRaw, 'embedding_authorization_review_json_invalid'),
        proposal,
        input.proposalRaw,
        codeStateDigest,
        checks,
        nowMs,
    );
    const dispatch = validateDispatch(
        parseJson(input.dispatchEvidenceRaw, 'embedding_authorization_dispatch_json_invalid'),
        codeStateDigest,
        review,
        nowMs,
    );
    return {
        proposal,
        checks,
        review,
        dispatch,
        codeStateDigest,
        baseline: validateBaseline(input, proposal),
    };
}

function validateChecks(
    value: unknown,
    codeStateDigest: string,
    releaseScriptRaw: Buffer,
    operatorReviewedAtMs: number,
    nowMs: number,
): DeterministicChecks {
    if (!isRecord(value)) throw checksError();
    assertExactKeys(value, [
        'schemaVersion',
        'codeStateDigest',
        'nodeGate',
        ...CHECK_FIELDS,
        'mlServicesDiffLines',
        'mlServicesStatusLines',
        'releaseScriptSha256',
    ], 'embedding_authorization_checks_invalid');
    if (!releaseScriptRaw.equals(Buffer.from(CANONICAL_RELEASE_SCRIPT))
        || value.schemaVersion !== 1
        || value.codeStateDigest !== codeStateDigest
        || value.releaseScriptSha256 !== sha256(releaseScriptRaw)
        || !Array.isArray(value.mlServicesDiffLines)
        || value.mlServicesDiffLines.length !== 0
        || !Array.isArray(value.mlServicesStatusLines)
        || value.mlServicesStatusLines.length !== 0
        || !isRecord(value.nodeGate)) {
        throw checksError();
    }
    assertExactKeys(
        value.nodeGate,
        ['command', 'exit', 'finishedAt', 'testFiles'],
        'embedding_authorization_checks_invalid',
    );
    validateCheck(value.nodeGate, TASK8_NODE_GATE_COMMAND, ['testFiles']);
    if (!Array.isArray(value.nodeGate.testFiles)
        || !isDeepStrictEqual(value.nodeGate.testFiles, [...TASK8_NODE_GATE_TEST_FILES])) {
        throw checksError();
    }
    for (const field of CHECK_FIELDS) {
        validateCheck(value[field], CHECK_COMMANDS[field]);
    }
    const results = [value.nodeGate, ...CHECK_FIELDS.map((field) => value[field])] as CheckResult[];
    if (results.some((result) => {
        const finishedAtMs = Date.parse(result.finishedAt);
        return finishedAtMs < operatorReviewedAtMs || finishedAtMs > nowMs;
    })) {
        throw checksError();
    }
    return value as unknown as DeterministicChecks;
}

function validateCheck(
    value: unknown,
    expectedCommand: string,
    extraFields: string[] = [],
): asserts value is CheckResult {
    if (!isRecord(value)) throw checksError();
    assertExactKeys(
        value,
        ['command', 'exit', 'finishedAt', ...extraFields],
        'embedding_authorization_checks_invalid',
    );
    if (value.command !== expectedCommand || value.exit !== 0 || !isIsoDate(value.finishedAt)) {
        throw checksError();
    }
}

function validateReview(
    value: unknown,
    proposal: EmbeddingContractRepairProposal,
    proposalRaw: Buffer,
    codeStateDigest: string,
    checks: DeterministicChecks,
    nowMs: number,
): ProposalReview {
    if (!isRecord(value)) throw reviewError();
    assertExactKeys(value, [
        'schemaVersion',
        'decision',
        'productionAuthorization',
        'reviewer',
        'reviewedAt',
        'proposalFileSha256',
        'proposalDigest',
        'quarantineDigest',
        'corpusStateDigest',
        'fullScan',
        'codeStateDigest',
    ], 'embedding_authorization_review_invalid');
    if (!isRecord(value.reviewer)) throw reviewError();
    assertExactKeys(
        value.reviewer,
        ['agentId', 'model', 'reasoningEffort'],
        'embedding_authorization_review_invalid',
    );
    const reviewedAtMs = Date.parse(String(value.reviewedAt));
    const results = [checks.nodeGate, ...CHECK_FIELDS.map((field) => checks[field])];
    if (value.schemaVersion !== 1
        || value.decision !== 'APPROVED_FOR_AUTHORIZATION_REQUEST'
        || value.productionAuthorization !== 'NOT_GRANTED'
        || !isNonPlaceholder(value.reviewer.agentId)
        || value.reviewer.model !== 'gpt-5.6-sol'
        || value.reviewer.reasoningEffort !== 'ultra'
        || !isIsoDate(value.reviewedAt)
        || value.proposalFileSha256 !== sha256(proposalRaw)
        || value.proposalDigest !== proposal.proposalDigest
        || value.quarantineDigest !== proposal.quarantineDigest
        || value.corpusStateDigest !== proposal.corpusStateDigest
        || value.fullScan !== proposal.fullScan
        || value.fullScan !== true
        || value.codeStateDigest !== codeStateDigest
        || reviewedAtMs > nowMs
        || results.some((result) => Date.parse(result.finishedAt) > reviewedAtMs)) {
        throw reviewError();
    }
    return value as unknown as ProposalReview;
}

function validateDispatch(
    value: unknown,
    codeStateDigest: string,
    review: ProposalReview,
    nowMs: number,
): DispatchEvidence {
    if (!isRecord(value)) throw dispatchError();
    assertExactKeys(
        value,
        ['schemaVersion', 'codeStateDigest', 'dispatches'],
        'embedding_authorization_dispatch_invalid',
    );
    if (value.schemaVersion !== 1
        || value.codeStateDigest !== codeStateDigest
        || !Array.isArray(value.dispatches)
        || value.dispatches.length === 0) {
        throw dispatchError();
    }
    const rolesByTask = new Map<number, Set<string>>();
    const seenTaskRoles = new Set<string>();
    const independentAgentIds = new Set<string>();
    let proposalReviewer: Record<string, unknown> | undefined;
    let finalReviewer: Record<string, unknown> | undefined;
    for (const row of value.dispatches) {
        if (!isRecord(row)) throw dispatchError();
        assertExactKeys(
            row,
            ['task', 'role', 'agentId', 'model', 'reasoningEffort', 'status', 'finishedAt'],
            'embedding_authorization_dispatch_invalid',
        );
        if (!TASKS.includes(row.task as 4 | 5 | 6 | 7 | 8)
            || !isRole(row.role)
            || !isNonPlaceholder(row.agentId)
            || row.model !== 'gpt-5.6-sol'
            || row.reasoningEffort !== 'ultra'
            || row.status !== 'DONE'
            || !isIsoDate(row.finishedAt)) {
            throw dispatchError();
        }
        const task = row.task as 4 | 5 | 6 | 7 | 8;
        const role = row.role as string;
        const finishedAtMs = Date.parse(row.finishedAt as string);
        const isFinalReviewer = task === 8 && role === 'final_reviewer';
        if (finishedAtMs > nowMs
            || (!isFinalReviewer && finishedAtMs > Date.parse(review.reviewedAt))) {
            throw dispatchError();
        }
        const key = `${task}:${role}`;
        if (seenTaskRoles.has(key)) throw dispatchError();
        seenTaskRoles.add(key);
        const roles = rolesByTask.get(task) ?? new Set<string>();
        roles.add(role);
        rolesByTask.set(task, roles);
        if (INDEPENDENT_ROLES.has(role)) {
            if (independentAgentIds.has(row.agentId as string)) throw dispatchError();
            independentAgentIds.add(row.agentId as string);
        }
        if (task === 8 && role === 'proposal_reviewer') proposalReviewer = row;
        if (task === 8 && role === 'final_reviewer') finalReviewer = row;
    }
    if (!TASKS.every((task) => REQUIRED_ROLES[task].every((role) => rolesByTask.get(task)?.has(role)))
        || !proposalReviewer
        || !finalReviewer
        || proposalReviewer.agentId !== review.reviewer.agentId
        || proposalReviewer.model !== review.reviewer.model
        || proposalReviewer.reasoningEffort !== review.reviewer.reasoningEffort
        || proposalReviewer.finishedAt !== review.reviewedAt
        || Date.parse(String(finalReviewer.finishedAt)) <= Date.parse(String(proposalReviewer.finishedAt))) {
        throw dispatchError();
    }
    return value as unknown as DispatchEvidence;
}

function validateBaseline(
    input: EmbeddingRemediationAuthorizationPacketRawInput,
    proposal: EmbeddingContractRepairProposal,
): BaselineEvidence | null {
    const values = [input.baselineJsonRaw, input.baselineStderrRaw, input.baselineExitRaw];
    const present = values.filter((value) => value !== undefined).length;
    if (present === 0) return null;
    if (present !== values.length
        || !Buffer.isBuffer(input.baselineJsonRaw)
        || !Buffer.isBuffer(input.baselineStderrRaw)
        || !Buffer.isBuffer(input.baselineExitRaw)) {
        throw baselineError();
    }
    const exit = input.baselineExitRaw.toString('utf8').trim();
    const baseline = parseJson(input.baselineJsonRaw, 'embedding_authorization_baseline_json_invalid');
    if ((exit !== '0' && exit !== '2')
        || !isRecord(baseline)
        || baseline.strict !== true
        || baseline.diagnosticOnly !== false
        || baseline.quarantineApproval !== 'matched'
        || !isRecord(baseline.auditMongoEvidence)
        || !isSafeText(baseline.auditMongoEvidence.evidenceFile)
        || path.resolve(baseline.auditMongoEvidence.evidenceFile) !== path.resolve(input.operatorEvidencePath)
        || baseline.auditMongoEvidence.evidenceFileSha256 !== sha256(input.operatorEvidenceRaw)
        || baseline.auditMongoEvidence.meaning !== 'operator_review_only'
        || !isFullEmbeddingEvidenceSummary(baseline.embeddingEvidence)
        || baseline.embeddingEvidence.quarantineDigest !== proposal.quarantineDigest) {
        throw baselineError();
    }
    const expectedExit = resolveEmbeddingAuditExitCode({
        strict: true,
        diagnosticOnly: false,
        embeddingEvidence: baseline.embeddingEvidence,
        approvedQuarantineDigest: proposal.quarantineDigest,
    });
    if (String(expectedExit) !== exit || baseline.releasePass !== (expectedExit === 0)) {
        throw baselineError();
    }
    return {
        exit,
        jsonSha256: sha256(input.baselineJsonRaw),
        stderrSha256: sha256(input.baselineStderrRaw),
        exitSha256: sha256(input.baselineExitRaw),
    };
}

function renderChecksums(
    input: EmbeddingRemediationAuthorizationPacketRawInput,
    packetRaw: Buffer,
    options: CliOptions,
): string {
    const rows: Array<[Buffer, string]> = [
        [input.proposalRaw, 'proposal.json'],
        [input.deterministicChecksRaw, 'deterministic-checks.json'],
        [input.dispatchEvidenceRaw, 'dispatch-evidence.json'],
        [input.proposalReviewRaw, 'proposal-review.json'],
        [input.operatorEvidenceRaw, input.operatorEvidencePath],
        [input.releaseScriptRaw, options.releaseScript],
        [packetRaw, path.basename(options.packetOutput)],
    ];
    if (input.baselineJsonRaw && input.baselineStderrRaw && input.baselineExitRaw) {
        rows.push(
            [input.baselineJsonRaw, 'pre-apply-baseline-audit.json'],
            [input.baselineStderrRaw, 'pre-apply-baseline-audit.stderr'],
            [input.baselineExitRaw, 'pre-apply-baseline-audit.exit'],
        );
    }
    return `${rows.map(([raw, label]) => `${sha256(raw)}  ${label}`).join('\n')}\n`;
}

async function publishOutputs(
    options: CliOptions,
    packet: string,
    checksums: string,
    dependencies: AuthorizationPacketCliDependencies,
): Promise<void> {
    const token = `${process.pid}-${crypto.randomUUID()}`;
    const packetTemp = adjacentTemp(options.packetOutput, token);
    const checksumsTemp = adjacentTemp(options.checksumsOutput, token);
    let packetIdentity: FileIdentity | undefined;
    let checksumsIdentity: FileIdentity | undefined;
    try {
        await dependencies.writeFile(checksumsTemp, checksums, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
        });
        checksumsIdentity = await fileIdentity(checksumsTemp, dependencies);
        await dependencies.writeFile(packetTemp, packet, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
        });
        packetIdentity = await fileIdentity(packetTemp, dependencies);
        await dependencies.link(checksumsTemp, options.checksumsOutput);
        await assertPublishedIdentity(options.checksumsOutput, checksumsIdentity, dependencies);
        await dependencies.link(packetTemp, options.packetOutput);
        await assertPublishedPair(
            options,
            packetIdentity,
            checksumsIdentity,
            dependencies,
        );
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error('embedding_authorization_output_exists');
        }
        throw error;
    } finally {
        await safeUnlinkCreatedPath(packetTemp, packetIdentity, dependencies);
        await safeUnlinkCreatedPath(checksumsTemp, checksumsIdentity, dependencies);
    }
}

function adjacentTemp(outputPath: string, token: string): string {
    return path.join(
        path.dirname(outputPath),
        `.${path.basename(outputPath)}.${token}.tmp`,
    );
}

interface FileIdentity {
    dev: number | bigint;
    ino: number | bigint;
}

interface OwnedPath {
    path: string;
    identity: FileIdentity;
}

async function acquireInvocationLock(
    packetOutput: string,
    dependencies: AuthorizationPacketCliDependencies,
): Promise<OwnedPath> {
    const lockPath = path.join(
        path.dirname(packetOutput),
        `.${path.basename(packetOutput)}.render.lock`,
    );
    try {
        await dependencies.writeFile(lockPath, crypto.randomUUID(), {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600,
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error('embedding_authorization_output_busy');
        }
        throw error;
    }
    return { path: lockPath, identity: await fileIdentity(lockPath, dependencies) };
}

async function fileIdentity(
    filePath: string,
    dependencies: AuthorizationPacketCliDependencies,
): Promise<FileIdentity> {
    const value = await dependencies.stat(filePath);
    return { dev: value.dev, ino: value.ino };
}

async function assertPublishedIdentity(
    filePath: string,
    expected: FileIdentity,
    dependencies: AuthorizationPacketCliDependencies,
): Promise<void> {
    let current: FileIdentity;
    try {
        current = await fileIdentity(filePath, dependencies);
    } catch {
        throw new Error('embedding_authorization_output_drift');
    }
    if (!sameFileIdentity(current, expected)) {
        throw new Error('embedding_authorization_output_drift');
    }
}

async function assertPublishedPair(
    options: CliOptions,
    packetIdentity: FileIdentity,
    checksumsIdentity: FileIdentity,
    dependencies: AuthorizationPacketCliDependencies,
): Promise<void> {
    await Promise.all([
        assertPublishedIdentity(options.checksumsOutput, checksumsIdentity, dependencies),
        assertPublishedIdentity(options.packetOutput, packetIdentity, dependencies),
    ]);
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
    return left.dev === right.dev && left.ino === right.ino;
}

// Final output paths must never reach this cleanup helper.
async function safeUnlinkCreatedPath(
    filePath: string,
    identity: FileIdentity | undefined,
    dependencies: AuthorizationPacketCliDependencies,
): Promise<void> {
    if (!identity) return;
    try {
        const current = await dependencies.stat(filePath);
        if (!sameFileIdentity(current, identity)) return;
        await dependencies.unlink(filePath);
    } catch {
        // Best effort cleanup; the readiness packet is always published last.
    }
}

function assertOutputPaths(options: CliOptions): void {
    const outputs = [options.packetOutput, options.checksumsOutput];
    const inputs = [
        path.join(options.artifactsDir, 'proposal.json'),
        path.join(options.artifactsDir, 'deterministic-checks.json'),
        path.join(options.artifactsDir, 'dispatch-evidence.json'),
        path.join(options.artifactsDir, 'proposal-review.json'),
        path.join(options.artifactsDir, 'pre-apply-baseline-audit.json'),
        path.join(options.artifactsDir, 'pre-apply-baseline-audit.stderr'),
        path.join(options.artifactsDir, 'pre-apply-baseline-audit.exit'),
        options.operatorEvidenceFile,
        options.releaseScript,
    ];
    if (outputs[0] === outputs[1] || outputs.some((output) => inputs.includes(output))) {
        throw new Error('embedding_authorization_output_path_conflict');
    }
}

function parseArgs(argv: readonly string[]): CliOptions {
    const values = new Map<string, string>();
    const allowed = new Set([
        '--repo-root',
        '--artifacts-dir',
        '--operator-evidence-file',
        '--release-script',
        '--packet-output',
        '--checksums-output',
    ]);
    for (let index = 0; index < argv.length; index += 2) {
        const argument = argv[index];
        const value = argv[index + 1];
        if (!allowed.has(argument) || !value || value.startsWith('--') || values.has(argument)) {
            throw new Error('embedding_authorization_argument_invalid');
        }
        values.set(argument, value);
    }
    const repoRoot = path.resolve(values.get('--repo-root') ?? path.resolve(__dirname, '../../..'));
    const artifactsDir = path.resolve(
        repoRoot,
        values.get('--artifacts-dir') ?? 'reports/recommendation/embedding-contract-remediation',
    );
    const operatorEvidenceFile = values.get('--operator-evidence-file')
        ?? process.env.RECOMMENDATION_AUDIT_READ_ONLY_EVIDENCE_FILE;
    if (!operatorEvidenceFile) throw new Error('embedding_authorization_operator_evidence_required');
    const releaseScript = path.resolve(
        repoRoot,
        values.get('--release-script') ?? 'tools/release/verify_all.sh',
    );
    return {
        repoRoot,
        artifactsDir,
        operatorEvidenceFile: path.resolve(repoRoot, operatorEvidenceFile),
        releaseScript,
        packetOutput: path.resolve(
            repoRoot,
            values.get('--packet-output') ?? path.join(artifactsDir, 'authorization-packet.md'),
        ),
        checksumsOutput: path.resolve(
            repoRoot,
            values.get('--checksums-output') ?? path.join(artifactsDir, 'SHA256SUMS'),
        ),
    };
}

async function readOptionalBaseline(
    artifactsDir: string,
    dependencies: AuthorizationPacketCliDependencies,
): Promise<Pick<
    EmbeddingRemediationAuthorizationPacketRawInput,
    'baselineJsonRaw' | 'baselineStderrRaw' | 'baselineExitRaw'
>> {
    const paths = {
        baselineJsonRaw: path.join(artifactsDir, 'pre-apply-baseline-audit.json'),
        baselineStderrRaw: path.join(artifactsDir, 'pre-apply-baseline-audit.stderr'),
        baselineExitRaw: path.join(artifactsDir, 'pre-apply-baseline-audit.exit'),
    } as const;
    const output: Partial<Record<keyof typeof paths, Buffer>> = {};
    for (const [field, filePath] of Object.entries(paths) as Array<[keyof typeof paths, string]>) {
        if (await dependencies.fileExists(filePath)) {
            output[field] = await dependencies.readFile(filePath);
        }
    }
    return output;
}

async function loadAuthorizationPacketInput(
    options: CliOptions,
    dependencies: AuthorizationPacketCliDependencies,
): Promise<EmbeddingRemediationAuthorizationPacketRawInput> {
    const [codeState, proposalRaw, deterministicChecksRaw, dispatchEvidenceRaw,
        proposalReviewRaw, operatorEvidenceRaw, releaseScriptRaw] = await Promise.all([
        dependencies.loadCodeState(),
        dependencies.readFile(path.join(options.artifactsDir, 'proposal.json')),
        dependencies.readFile(path.join(options.artifactsDir, 'deterministic-checks.json')),
        dependencies.readFile(path.join(options.artifactsDir, 'dispatch-evidence.json')),
        dependencies.readFile(path.join(options.artifactsDir, 'proposal-review.json')),
        dependencies.readFile(options.operatorEvidenceFile),
        dependencies.readFile(options.releaseScript),
    ]);
    const baseline = await readOptionalBaseline(options.artifactsDir, dependencies);
    return {
        ...codeState,
        proposalRaw,
        deterministicChecksRaw,
        dispatchEvidenceRaw,
        proposalReviewRaw,
        operatorEvidencePath: options.operatorEvidenceFile,
        operatorEvidenceRaw,
        releaseScriptRaw,
        ...baseline,
    };
}

function computeInputSnapshotDigest(
    input: EmbeddingRemediationAuthorizationPacketRawInput,
): string {
    return canonicalDigest({
        schemaVersion: 1,
        codeStateDigest: computeEmbeddingRemediationCodeStateDigest(input),
        proposalSha256: sha256(input.proposalRaw),
        deterministicChecksSha256: sha256(input.deterministicChecksRaw),
        dispatchEvidenceSha256: sha256(input.dispatchEvidenceRaw),
        proposalReviewSha256: sha256(input.proposalReviewRaw),
        operatorEvidencePath: input.operatorEvidencePath,
        operatorEvidenceSha256: sha256(input.operatorEvidenceRaw),
        releaseScriptSha256: sha256(input.releaseScriptRaw),
        baselineJsonSha256: input.baselineJsonRaw ? sha256(input.baselineJsonRaw) : null,
        baselineStderrSha256: input.baselineStderrRaw ? sha256(input.baselineStderrRaw) : null,
        baselineExitSha256: input.baselineExitRaw ? sha256(input.baselineExitRaw) : null,
    });
}

async function loadGitCodeState(repoRoot: string): Promise<EmbeddingRemediationCodeState> {
    const git = (args: string[], encoding?: BufferEncoding): Buffer | string => execFileSync(
        'git',
        ['-C', repoRoot, ...args],
        { encoding: encoding ?? 'buffer', maxBuffer: 128 * 1024 * 1024 },
    );
    const gitSha = String(git(['rev-parse', 'HEAD'], 'utf8')).trim();
    const branch = String(git(['branch', '--show-current'], 'utf8')).trim() || 'DETACHED';
    const worktreeStatus = String(git(['status', '--short'], 'utf8'));
    const trackedDiffRaw = Buffer.from(git(['diff', '--binary', 'HEAD', '--']) as Buffer);
    const untrackedPaths = String(git(['ls-files', '--others', '--exclude-standard', '-z'], 'utf8'))
        .split('\0')
        .filter(Boolean);
    const untracked = await Promise.all(untrackedPaths.map(async (filePath) => ({
        path: filePath,
        raw: await readFile(path.join(repoRoot, filePath)),
    })));
    return { gitSha, branch, worktreeStatus, trackedDiffRaw, untracked };
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

function parseJson(raw: Buffer, error: string): unknown {
    try {
        return JSON.parse(raw.toString('utf8'));
    } catch {
        throw new Error(error);
    }
}

function assertExactKeys(value: Record<string, unknown>, expected: string[], error: string): void {
    if (!isDeepStrictEqual(Object.keys(value).sort(compareUtf8), [...expected].sort(compareUtf8))) {
        throw new Error(error);
    }
}

function checksError(): Error {
    return new Error('embedding_authorization_checks_invalid');
}

function reviewError(): Error {
    return new Error('embedding_authorization_review_invalid');
}

function dispatchError(): Error {
    return new Error('embedding_authorization_dispatch_invalid');
}

function baselineError(): Error {
    return new Error('embedding_authorization_baseline_invalid');
}

function isIsoDate(value: unknown): value is string {
    if (typeof value !== 'string' || !value.endsWith('Z')) return false;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isNonPlaceholder(value: unknown): value is string {
    return isSafeText(value) && !/(actual|placeholder|tbd|todo|unknown|fill[_ -]?in)/i.test(value);
}

function isRole(value: unknown): value is string {
    return typeof value === 'string' && /^[a-z][a-z0-9_]*$/.test(value);
}

function isSafeText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && !/[\r\n]/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sha256(value: crypto.BinaryLike): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function compareUtf8(left: string, right: string): number {
    return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

if (require.main === module) {
    runEmbeddingRemediationAuthorizationPacketCli(process.argv.slice(2))
        .then((exitCode) => {
            process.exitCode = exitCode;
        });
}
