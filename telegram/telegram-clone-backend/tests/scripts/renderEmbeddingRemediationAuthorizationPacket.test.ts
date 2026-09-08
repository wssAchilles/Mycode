import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
    link as linkFile,
    mkdtemp,
    readFile,
    readdir,
    rm,
    stat as statFile,
    unlink as unlinkFile,
    writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
    computeProposalDigest,
} from '../../src/services/ops/recommendation/embeddingRepair/artifacts';
import type {
    EmbeddingContractRepairProposal,
    EmbeddingContractRepairProposalInput,
} from '../../src/services/ops/recommendation/embeddingRepair/contracts';
import {
    BACKEND_TSC_COMMAND,
    DIFF_CHECK_COMMAND,
    RELEASE_FORBIDDEN_SCAN_COMMAND,
    RELEASE_FORBIDDEN_SCAN_PATTERN,
    RELEASE_SHELL_SYNTAX_COMMAND,
    TASK4_FOCUSED_VITEST_COMMAND,
    TASK8_NODE_GATE_TEST_FILES,
    TASK8_NODE_GATE_COMMAND,
    TASK8_PACKET_RENDERER_VITEST_COMMAND,
    computeEmbeddingRemediationCodeStateDigest,
    renderEmbeddingRemediationAuthorizationPacket,
    runEmbeddingRemediationAuthorizationPacketCli,
    type EmbeddingRemediationAuthorizationPacketRawInput,
    type EmbeddingRemediationCodeState,
} from '../../src/scripts/renderEmbeddingRemediationAuthorizationPacket';

const FINISHED_AT = '2026-07-13T00:00:00.000Z';
const CANONICAL_RELEASE_SCRIPT_RAW = readFileSync(
    path.resolve(__dirname, '../../../tools/release/verify_all.sh'),
);

describe('release forbidden scan pattern', () => {
    it.each([
        'python script.py',
        'python -m unittest',
        'python3 script.py',
        'python3.12 -m unittest',
        '/usr/bin/python3.13 script.py',
    ])('matches Python execution: %s', (command) => {
        expect(command).toMatch(new RegExp(RELEASE_FORBIDDEN_SCAN_PATTERN));
    });

    it.each([
        'echo pythonic',
        'python-wrapper script.py',
    ])('does not treat unrelated text as Python execution: %s', (command) => {
        expect(command).not.toMatch(new RegExp(RELEASE_FORBIDDEN_SCAN_PATTERN));
    });
});

describe('renderEmbeddingRemediationAuthorizationPacket', () => {
    it('renders a digest-bound code-and-dry-run packet with explicit replay counts', () => {
        const input = validRawInput();

        const packet = renderEmbeddingRemediationAuthorizationPacket(input);

        expect(packet).toContain('- Readiness: CODE_AND_DRY_RUN_READY');
        expect(packet).toContain('- Production authorization: NOT GRANTED');
        expect(packet).toContain('- Task 9: UNAUTHORIZED');
        expect(packet).toContain('- Phase 0.5 gate complete: NO');
        expect(packet).toContain(`- Code state digest: ${fixtureCodeStateDigest(input)}`);
        expect(packet).toContain('- User replay matched: 0');
        expect(packet).toContain('- User replay mismatched: 0');
        expect(packet).toContain('- User replay input missing: 0');
        expect(packet).toContain('- Post replay matched: 0');
        expect(packet).toContain('- Post replay mismatched: 0');
        expect(packet).not.toContain('undefined');
    });

    it.each([
        ['tampered digest', (proposal: EmbeddingContractRepairProposal) => ({
            ...proposal,
            proposalDigest: 'f'.repeat(64),
        })],
        ['diagnostic proposal', (proposal: EmbeddingContractRepairProposal) => withProposalDigest({
            ...proposal,
            mode: 'diagnostic',
            fullScan: false,
        })],
        ['non-authorizable evidence', (proposal: EmbeddingContractRepairProposal) => withProposalDigest({
            ...proposal,
            scanned: { users: 0, postFeatureSnapshots: 1 },
            evidence: {
                aggregate: evidenceSummary({ total: 1, unclassified: 1 }),
                cohorts: {
                    userVectors: evidenceSummary(),
                    postFeatureSnapshots: evidenceSummary({ total: 1, unclassified: 1 }),
                },
            },
            replay: {
                user: { matched: 0, mismatched: 0, inputMissing: 0 },
                post: { matched: 1, mismatched: 0 },
            },
        })],
    ])('rejects a %s before rendering', (_name, mutate) => {
        const input = validRawInput();
        input.proposalRaw = jsonRaw(mutate(parseJson<EmbeddingContractRepairProposal>(input.proposalRaw)));

        expect(() => renderEmbeddingRemediationAuthorizationPacket(input)).toThrow();
    });

    it.each([
        ['invalid schema', (evidence: any) => {
            delete evidence.database;
        }],
        ['wrong role', (evidence: any) => {
            evidence.role = 'readWrite';
        }],
        ['expired review', (evidence: any) => {
            evidence.expiresAt = '2000-01-01T00:00:00.000Z';
        }],
    ])('rejects operator evidence with %s', (_name, mutate) => {
        const input = validRawInput();
        const evidence = parseJson<any>(input.operatorEvidenceRaw);
        mutate(evidence);
        input.operatorEvidenceRaw = jsonRaw(evidence);

        expect(() => renderEmbeddingRemediationAuthorizationPacket(input))
            .toThrow(/recommendation_audit_/);
    });

    it.each([
        ['nonzero renderer test exit', (checks: any) => {
            checks.packetRendererVitest.exit = 1;
        }],
        ['incomplete node test list', (checks: any) => {
            checks.nodeGate.testFiles.pop();
        }],
        ['release script digest drift', (checks: any) => {
            checks.releaseScriptSha256 = 'f'.repeat(64);
        }],
        ['code state drift', (checks: any) => {
            checks.codeStateDigest = 'e'.repeat(64);
        }],
        ['canonical command drift', (checks: any) => {
            checks.backendTsc.command = `${checks.backendTsc.command}x`;
        }],
    ])('rejects deterministic checks with %s', (_name, mutate) => {
        const input = validRawInput();
        const checks = parseJson<any>(input.deterministicChecksRaw);
        mutate(checks);
        input.deterministicChecksRaw = jsonRaw(checks);

        expect(() => renderEmbeddingRemediationAuthorizationPacket(input))
            .toThrow(/embedding_authorization_checks/);
    });

    it.each([
        ['the C++ stage removed', (script: string) => script.replace(
            'bash "$ROOT_DIR/tools/release/verify_cpp.sh"\n',
            '',
        )],
        ['the Go stage removed', (script: string) => script.replace(
            'bash "$ROOT_DIR/tools/release/verify_go.sh"\n',
            '',
        )],
        ['the Node stage removed', (script: string) => script.replace(
            'npm --prefix "$ROOT_DIR/telegram-clone-backend" test -- \\\n',
            '',
        )],
        ['one Node gate test removed', (script: string) => script.replace(
            '  tests/recommendation/newsAnnSource.test.ts \\\n',
            '',
        )],
        ['the Rust replay stage removed', (script: string) => script.replace(
            'cargo test \\\n',
            '',
        )],
        ['the strict audit stage removed', (script: string) => script.replace(
            'npm --prefix "$ROOT_DIR/telegram-clone-backend" run audit:embedding-contracts -- \\\n',
            '',
        )],
        ['C++ and Go stages reordered', (script: string) => script.replace(
            'bash "$ROOT_DIR/tools/release/verify_cpp.sh"\n'
            + 'bash "$ROOT_DIR/tools/release/verify_go.sh"\n',
            'bash "$ROOT_DIR/tools/release/verify_go.sh"\n'
            + 'bash "$ROOT_DIR/tools/release/verify_cpp.sh"\n',
        )],
    ])('rejects a release script with %s even when its digest evidence matches', (_name, mutate) => {
        const input = validRawInput();
        input.releaseScriptRaw = Buffer.from(mutate(input.releaseScriptRaw.toString('utf8')));
        const checks = parseJson<any>(input.deterministicChecksRaw);
        checks.releaseScriptSha256 = sha256(input.releaseScriptRaw);
        input.deterministicChecksRaw = jsonRaw(checks);

        expect(() => renderEmbeddingRemediationAuthorizationPacket(input))
            .toThrow(/embedding_authorization_checks/);
    });

    it.each([
        ['rejected decision', (review: any) => {
            review.decision = 'REJECTED';
        }],
        ['proposal file digest drift', (review: any) => {
            review.proposalFileSha256 = 'f'.repeat(64);
        }],
        ['proposal digest drift', (review: any) => {
            review.proposalDigest = 'f'.repeat(64);
        }],
        ['wrong reviewer model', (review: any) => {
            review.reviewer.model = 'gpt-5.5';
        }],
    ])('rejects proposal review with %s', (_name, mutate) => {
        const input = validRawInput();
        const review = parseJson<any>(input.proposalReviewRaw);
        mutate(review);
        input.proposalReviewRaw = jsonRaw(review);

        expect(() => renderEmbeddingRemediationAuthorizationPacket(input))
            .toThrow(/embedding_authorization_review/);
    });

    it.each([
        ['placeholder agent id', (dispatch: any) => {
            dispatch.dispatches[0].agentId = 'ACTUAL_AGENT_ID';
        }],
        ['missing task', (dispatch: any) => {
            dispatch.dispatches = dispatch.dispatches.filter((row: any) => row.task !== 4);
        }],
        ['missing Task 8 final reviewer', (dispatch: any) => {
            dispatch.dispatches = dispatch.dispatches.filter((row: any) => row.role !== 'final_reviewer');
        }],
        ['missing required role', (dispatch: any) => {
            dispatch.dispatches = dispatch.dispatches.filter((row: any) => (
                row.task !== 4 || row.role !== 'spec_reviewer'
            ));
        }],
        ['duplicate task role', (dispatch: any) => {
            dispatch.dispatches.push({ ...dispatch.dispatches[0], agentId: '/root/duplicate' });
        }],
        ['invalid completion time', (dispatch: any) => {
            dispatch.dispatches[0].finishedAt = 'not-a-date';
        }],
        ['reviewer identity drift', (dispatch: any) => {
            const reviewer = dispatch.dispatches.find((row: any) => row.role === 'proposal_reviewer');
            reviewer.agentId = '/root/different-reviewer';
        }],
        ['reversed reviewer order', (dispatch: any) => {
            const finalReviewer = dispatch.dispatches.find((row: any) => row.role === 'final_reviewer');
            finalReviewer.finishedAt = FINISHED_AT;
        }],
        ['implementer reused as reviewer', (dispatch: any) => {
            const implementer = dispatch.dispatches.find((row: any) => (
                row.task === 4 && row.role === 'implementer'
            ));
            const reviewer = dispatch.dispatches.find((row: any) => (
                row.task === 4 && row.role === 'spec_reviewer'
            ));
            reviewer.agentId = implementer.agentId;
        }],
        ['proposal reviewer reused as final reviewer', (dispatch: any) => {
            const proposalReviewer = dispatch.dispatches.find((row: any) => row.role === 'proposal_reviewer');
            const finalReviewer = dispatch.dispatches.find((row: any) => row.role === 'final_reviewer');
            finalReviewer.agentId = proposalReviewer.agentId;
        }],
    ])('rejects dispatch evidence with %s', (_name, mutate) => {
        const input = validRawInput();
        const dispatch = parseJson<any>(input.dispatchEvidenceRaw);
        mutate(dispatch);
        input.dispatchEvidenceRaw = jsonRaw(dispatch);

        expect(() => renderEmbeddingRemediationAuthorizationPacket(input))
            .toThrow(/embedding_authorization_dispatch/);
    });

    it('rejects deterministic checks completed in the future', () => {
        const input = validRawInput();
        const checks = parseJson<any>(input.deterministicChecksRaw);
        checks.backendTsc.finishedAt = '2026-07-14T00:02:00.000Z';
        input.deterministicChecksRaw = jsonRaw(checks);

        expect(() => renderEmbeddingRemediationAuthorizationPacket(
            input,
            Date.parse('2026-07-14T00:01:00.000Z'),
        )).toThrow(/embedding_authorization_checks/);
    });

    it('rejects deterministic checks completed before the operator review', () => {
        const input = validRawInput();
        const evidence = parseJson<any>(input.operatorEvidenceRaw);
        evidence.reviewedAt = '2026-07-01T00:00:00.000Z';
        input.operatorEvidenceRaw = jsonRaw(evidence);
        const checks = parseJson<any>(input.deterministicChecksRaw);
        checks.backendTsc.finishedAt = '2026-06-30T23:59:00.000Z';
        input.deterministicChecksRaw = jsonRaw(checks);

        expect(() => renderEmbeddingRemediationAuthorizationPacket(
            input,
            Date.parse('2026-07-15T00:00:00.000Z'),
        )).toThrow(/embedding_authorization_checks/);
    });

    it('rejects a proposal review completed before deterministic checks', () => {
        const input = validRawInput();
        const checks = parseJson<any>(input.deterministicChecksRaw);
        checks.backendTsc.finishedAt = '2026-07-14T00:01:00.000Z';
        input.deterministicChecksRaw = jsonRaw(checks);

        expect(() => renderEmbeddingRemediationAuthorizationPacket(
            input,
            Date.parse('2026-07-14T00:02:00.000Z'),
        )).toThrow(/embedding_authorization_review/);
    });

    it('rejects a proposal review completed in the future', () => {
        const input = validRawInput();
        const review = parseJson<any>(input.proposalReviewRaw);
        review.reviewedAt = '2026-07-14T00:02:00.000Z';
        input.proposalReviewRaw = jsonRaw(review);
        const dispatch = parseJson<any>(input.dispatchEvidenceRaw);
        const proposalReviewer = dispatch.dispatches.find((row: any) => row.role === 'proposal_reviewer');
        proposalReviewer.finishedAt = review.reviewedAt;
        const finalReviewer = dispatch.dispatches.find((row: any) => row.role === 'final_reviewer');
        finalReviewer.finishedAt = '2026-07-14T00:03:00.000Z';
        input.dispatchEvidenceRaw = jsonRaw(dispatch);

        expect(() => renderEmbeddingRemediationAuthorizationPacket(
            input,
            Date.parse('2026-07-14T00:01:00.000Z'),
        )).toThrow(/embedding_authorization_review/);
    });

    it('rejects a non-final dispatch completed after the proposal review', () => {
        const input = validRawInput();
        const dispatch = parseJson<any>(input.dispatchEvidenceRaw);
        const implementer = dispatch.dispatches.find((row: any) => (
            row.task === 4 && row.role === 'implementer'
        ));
        implementer.finishedAt = '2026-07-14T00:01:00.000Z';
        input.dispatchEvidenceRaw = jsonRaw(dispatch);

        expect(() => renderEmbeddingRemediationAuthorizationPacket(
            input,
            Date.parse('2026-07-14T00:02:00.000Z'),
        )).toThrow(/embedding_authorization_dispatch/);
    });

    it('rejects a final review completed in the future', () => {
        const input = validRawInput();
        const dispatch = parseJson<any>(input.dispatchEvidenceRaw);
        const finalReviewer = dispatch.dispatches.find((row: any) => row.role === 'final_reviewer');
        finalReviewer.finishedAt = '2026-07-14T00:02:00.000Z';
        input.dispatchEvidenceRaw = jsonRaw(dispatch);

        expect(() => renderEmbeddingRemediationAuthorizationPacket(
            input,
            Date.parse('2026-07-14T00:01:00.000Z'),
        )).toThrow(/embedding_authorization_dispatch/);
    });

    it('accepts inclusive evidence boundaries and a final review completed at now', () => {
        const input = validRawInput();
        const evidence = parseJson<any>(input.operatorEvidenceRaw);
        evidence.reviewedAt = '2026-07-01T00:00:00.000Z';
        input.operatorEvidenceRaw = jsonRaw(evidence);
        const checks = parseJson<any>(input.deterministicChecksRaw);
        for (const value of Object.values(checks)) {
            if (value && typeof value === 'object' && 'finishedAt' in value) {
                value.finishedAt = evidence.reviewedAt;
            }
        }
        input.deterministicChecksRaw = jsonRaw(checks);
        const review = parseJson<any>(input.proposalReviewRaw);
        review.reviewedAt = evidence.reviewedAt;
        input.proposalReviewRaw = jsonRaw(review);
        const dispatch = parseJson<any>(input.dispatchEvidenceRaw);
        for (const row of dispatch.dispatches) row.finishedAt = evidence.reviewedAt;
        const finalReviewer = dispatch.dispatches.find((row: any) => row.role === 'final_reviewer');
        finalReviewer.finishedAt = '2026-07-01T00:01:00.000Z';
        input.dispatchEvidenceRaw = jsonRaw(dispatch);

        expect(renderEmbeddingRemediationAuthorizationPacket(
            input,
            Date.parse(finalReviewer.finishedAt),
        )).toContain('CODE_AND_DRY_RUN_READY');
    });

    it('binds a valid optional baseline trio into the packet', () => {
        const input = validRawInput();
        input.baselineJsonRaw = jsonRaw(validBaseline(input));
        input.baselineStderrRaw = Buffer.from('expected pending evidence\n');
        input.baselineExitRaw = Buffer.from('2\n');

        const packet = renderEmbeddingRemediationAuthorizationPacket(input);

        expect(packet).toContain('- Exit: 2');
        expect(packet).toContain(`- JSON SHA-256: ${sha256(input.baselineJsonRaw)}`);
        expect(packet).toContain(`- stderr SHA-256: ${sha256(input.baselineStderrRaw)}`);
        expect(packet).toContain(`- exit SHA-256: ${sha256(input.baselineExitRaw)}`);
    });

    it.each([
        ['partial trio', (input: EmbeddingRemediationAuthorizationPacketRawInput) => {
            input.baselineJsonRaw = jsonRaw(validBaseline(input));
        }],
        ['exit 3', (input: EmbeddingRemediationAuthorizationPacketRawInput) => {
            input.baselineJsonRaw = jsonRaw(validBaseline(input));
            input.baselineStderrRaw = Buffer.alloc(0);
            input.baselineExitRaw = Buffer.from('3\n');
        }],
        ['diagnostic baseline', (input: EmbeddingRemediationAuthorizationPacketRawInput) => {
            input.baselineJsonRaw = jsonRaw(validBaseline(input, { diagnosticOnly: true }));
            input.baselineStderrRaw = Buffer.alloc(0);
            input.baselineExitRaw = Buffer.from('2\n');
        }],
        ['another proposal quarantine digest', (input: EmbeddingRemediationAuthorizationPacketRawInput) => {
            const baseline = validBaseline(input);
            baseline.embeddingEvidence.quarantineDigest = 'c'.repeat(64);
            input.baselineJsonRaw = jsonRaw(baseline);
            input.baselineStderrRaw = Buffer.alloc(0);
            input.baselineExitRaw = Buffer.from('2\n');
        }],
        ['exit and result contradiction', (input: EmbeddingRemediationAuthorizationPacketRawInput) => {
            input.baselineJsonRaw = jsonRaw(validBaseline(input, { releasePass: true }));
            input.baselineStderrRaw = Buffer.alloc(0);
            input.baselineExitRaw = Buffer.from('2\n');
        }],
        ['incomplete evidence', (input: EmbeddingRemediationAuthorizationPacketRawInput) => {
            const baseline = validBaseline(input);
            delete (baseline.embeddingEvidence as any).cohorts;
            input.baselineJsonRaw = jsonRaw(baseline);
            input.baselineStderrRaw = Buffer.alloc(0);
            input.baselineExitRaw = Buffer.from('2\n');
        }],
        ['missing audit Mongo evidence', (input: EmbeddingRemediationAuthorizationPacketRawInput) => {
            const baseline = validBaseline(input);
            delete (baseline as any).auditMongoEvidence;
            input.baselineJsonRaw = jsonRaw(baseline);
            input.baselineStderrRaw = Buffer.alloc(0);
            input.baselineExitRaw = Buffer.from('2\n');
        }],
        ['different operator evidence path', (input: EmbeddingRemediationAuthorizationPacketRawInput) => {
            const baseline = validBaseline(input);
            baseline.auditMongoEvidence.evidenceFile = '/different/operator-evidence.json';
            input.baselineJsonRaw = jsonRaw(baseline);
            input.baselineStderrRaw = Buffer.alloc(0);
            input.baselineExitRaw = Buffer.from('2\n');
        }],
        ['different operator evidence digest', (input: EmbeddingRemediationAuthorizationPacketRawInput) => {
            const baseline = validBaseline(input);
            baseline.auditMongoEvidence.evidenceFileSha256 = 'f'.repeat(64);
            input.baselineJsonRaw = jsonRaw(baseline);
            input.baselineStderrRaw = Buffer.alloc(0);
            input.baselineExitRaw = Buffer.from('2\n');
        }],
    ])('rejects an optional baseline with %s', (_name, mutate) => {
        const input = validRawInput();
        mutate(input);

        expect(() => renderEmbeddingRemediationAuthorizationPacket(input))
            .toThrow(/embedding_authorization_baseline/);
    });
});

describe('runEmbeddingRemediationAuthorizationPacketCli', () => {
    it('is import-safe', async () => {
        await expect(import('../../src/scripts/renderEmbeddingRemediationAuthorizationPacket'))
            .resolves
            .toBeDefined();
    });

    it('writes the packet and complete checksums only after fixture validation succeeds', async () => {
        const fixture = await writeFixtureDirectory(validRawInput());
        const writeError = vi.fn();

        try {
            const exitCode = await runEmbeddingRemediationAuthorizationPacketCli([
                '--artifacts-dir', fixture.dir,
                '--operator-evidence-file', fixture.evidencePath,
                '--release-script', fixture.releaseScriptPath,
            ], {
                loadCodeState: async () => fixture.codeState,
                writeError,
            });

            expect(exitCode).toBe(0);
            expect(writeError).not.toHaveBeenCalled();
            expect(await readFile(path.join(fixture.dir, 'authorization-packet.md'), 'utf8'))
                .toContain('CODE_AND_DRY_RUN_READY');
            const checksums = await readFile(path.join(fixture.dir, 'SHA256SUMS'), 'utf8');
            for (const name of [
                'proposal.json',
                'deterministic-checks.json',
                'dispatch-evidence.json',
                'proposal-review.json',
                fixture.evidencePath,
                fixture.releaseScriptPath,
                'authorization-packet.md',
            ]) {
                expect(checksums).toContain(name);
            }
        } finally {
            await rm(fixture.dir, { recursive: true, force: true });
        }
    });

    it('does not write packet artifacts when validation fails', async () => {
        const input = validRawInput();
        const checks = parseJson<any>(input.deterministicChecksRaw);
        checks.diffCheck.exit = 1;
        input.deterministicChecksRaw = jsonRaw(checks);
        const fixture = await writeFixtureDirectory(input);

        try {
            const exitCode = await runEmbeddingRemediationAuthorizationPacketCli([
                '--artifacts-dir', fixture.dir,
                '--operator-evidence-file', fixture.evidencePath,
                '--release-script', fixture.releaseScriptPath,
            ], {
                loadCodeState: async () => fixture.codeState,
                writeError: vi.fn(),
            });

            expect(exitCode).toBe(3);
            await expect(readFile(path.join(fixture.dir, 'authorization-packet.md')))
                .rejects
                .toMatchObject({ code: 'ENOENT' });
            await expect(readFile(path.join(fixture.dir, 'SHA256SUMS')))
                .rejects
                .toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(fixture.dir, { recursive: true, force: true });
        }
    });

    it('rejects raw input drift detected by the pre-publication reread', async () => {
        const fixture = await writeFixtureDirectory(validRawInput());
        const proposalPath = path.join(fixture.dir, 'proposal.json');
        let proposalReads = 0;
        const read = vi.fn(async (filePath: Parameters<typeof readFile>[0]) => {
            const raw = await readFile(filePath);
            if (path.resolve(String(filePath)) === proposalPath && ++proposalReads === 2) {
                return Buffer.concat([raw, Buffer.from('\n')]);
            }
            return raw;
        });

        try {
            const exitCode = await runEmbeddingRemediationAuthorizationPacketCli(baseCliArgs(fixture), {
                readFile: read as typeof readFile,
                loadCodeState: async () => fixture.codeState,
                writeError: vi.fn(),
            });

            expect(exitCode).toBe(3);
            await expect(readFile(path.join(fixture.dir, 'authorization-packet.md')))
                .rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(path.join(fixture.dir, 'SHA256SUMS')))
                .rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(fixture.dir, { recursive: true, force: true });
        }
    });

    it('rejects code-state drift detected by the pre-publication reread', async () => {
        const fixture = await writeFixtureDirectory(validRawInput());
        let loads = 0;

        try {
            const exitCode = await runEmbeddingRemediationAuthorizationPacketCli(baseCliArgs(fixture), {
                loadCodeState: async () => (
                    loads++ === 0
                        ? fixture.codeState
                        : { ...fixture.codeState, worktreeStatus: `${fixture.codeState.worktreeStatus}\n M drift.ts` }
                ),
                writeError: vi.fn(),
            });

            expect(exitCode).toBe(3);
            await expect(readFile(path.join(fixture.dir, 'authorization-packet.md')))
                .rejects.toMatchObject({ code: 'ENOENT' });
            await expect(readFile(path.join(fixture.dir, 'SHA256SUMS')))
                .rejects.toMatchObject({ code: 'ENOENT' });
        } finally {
            await rm(fixture.dir, { recursive: true, force: true });
        }
    });

    it('leaves the published checksum as a fail-closed orphan when the final packet link fails', async () => {
        const fixture = await writeFixtureDirectory(validRawInput());
        const packetPath = path.join(fixture.dir, 'authorization-packet.md');
        const checksumsPath = path.join(fixture.dir, 'SHA256SUMS');
        const link = vi.fn(async (source: string, destination: string) => {
            if (destination === packetPath) throw new Error('packet link failed');
            await linkFile(source, destination);
        });

        try {
            const exitCode = await runEmbeddingRemediationAuthorizationPacketCli(baseCliArgs(fixture), {
                loadCodeState: async () => fixture.codeState,
                link,
                writeError: vi.fn(),
            });

            expect(exitCode).toBe(3);
            await expect(readFile(packetPath)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(await readFile(checksumsPath, 'utf8')).toContain('authorization-packet.md');
            expect((await readdir(fixture.dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
        } finally {
            await rm(fixture.dir, { recursive: true, force: true });
        }
    });

    it.each(['authorization-packet.md', 'SHA256SUMS'])(
        'does not overwrite %s created after the stale-output precheck',
        async (name) => {
            const fixture = await writeFixtureDirectory(validRawInput());
            const racedPath = path.join(fixture.dir, name);
            const sentinel = `raced:${name}\n`;
            let loads = 0;

            try {
                const exitCode = await runEmbeddingRemediationAuthorizationPacketCli(baseCliArgs(fixture), {
                    loadCodeState: async () => {
                        if (loads++ === 0) await writeFile(racedPath, sentinel, { flag: 'wx' });
                        return fixture.codeState;
                    },
                    writeError: vi.fn(),
                });

                expect(exitCode).toBe(3);
                expect(await readFile(racedPath, 'utf8')).toBe(sentinel);
                const other = name === 'authorization-packet.md' ? 'SHA256SUMS' : 'authorization-packet.md';
                if (name === 'authorization-packet.md') {
                    expect(await readFile(path.join(fixture.dir, other), 'utf8'))
                        .toContain('authorization-packet.md');
                } else {
                    await expect(readFile(path.join(fixture.dir, other)))
                        .rejects.toMatchObject({ code: 'ENOENT' });
                }
            } finally {
                await rm(fixture.dir, { recursive: true, force: true });
            }
        },
    );

    it('allows only one concurrent renderer to publish a self-consistent output pair', async () => {
        const first = await writeFixtureDirectory(validRawInput());
        const secondInput = validRawInput({
            ...fixtureCodeState(),
            branch: 'codex/concurrent-renderer',
        });
        const second = await writeFixtureDirectory(secondInput);
        const outputDir = await mkdtemp(path.join(os.tmpdir(), 'embedding-authorization-output-'));
        const packetPath = path.join(outputDir, 'authorization-packet.md');
        const checksumsPath = path.join(outputDir, 'SHA256SUMS');
        const firstError = vi.fn();
        const secondError = vi.fn();
        const outputArgs = [
            '--packet-output', packetPath,
            '--checksums-output', checksumsPath,
        ];

        try {
            const results = await Promise.all([
                runEmbeddingRemediationAuthorizationPacketCli([
                    ...baseCliArgs(first),
                    ...outputArgs,
                ], {
                    fileExists: async () => false,
                    loadCodeState: async () => first.codeState,
                    writeError: firstError,
                }),
                runEmbeddingRemediationAuthorizationPacketCli([
                    ...baseCliArgs(second),
                    ...outputArgs,
                ], {
                    fileExists: async () => false,
                    loadCodeState: async () => second.codeState,
                    writeError: secondError,
                }),
            ]);

            expect(results.slice().sort()).toEqual([0, 3]);
            const loserError = results[0] === 3 ? firstError : secondError;
            expect(loserError).toHaveBeenCalledWith(
                expect.stringContaining('embedding_authorization_output_busy'),
            );
            const packetRaw = await readFile(packetPath);
            const checksums = await readFile(checksumsPath, 'utf8');
            expect(checksums).toContain(`${sha256(packetRaw)}  authorization-packet.md`);
            const winner = results[0] === 0 ? first : second;
            expect(packetRaw.toString('utf8')).toContain(
                `- Code state digest: ${computeEmbeddingRemediationCodeStateDigest(winner.codeState)}`,
            );
        } finally {
            await Promise.all([
                rm(first.dir, { recursive: true, force: true }),
                rm(second.dir, { recursive: true, force: true }),
                rm(outputDir, { recursive: true, force: true }),
            ]);
        }
    });

    it('does not delete a checksum replaced by another writer after publication', async () => {
        const fixture = await writeFixtureDirectory(validRawInput());
        const packetPath = path.join(fixture.dir, 'authorization-packet.md');
        const checksumsPath = path.join(fixture.dir, 'SHA256SUMS');
        const foreignChecksum = 'foreign checksum\n';
        const replaceChecksumAndFail = async () => {
            await unlinkFile(checksumsPath);
            await writeFile(checksumsPath, foreignChecksum);
            throw new Error('packet publication failed');
        };
        const link = vi.fn(async (source: string, destination: string) => {
            if (destination === packetPath) return replaceChecksumAndFail();
            await linkFile(source, destination);
        });

        try {
            const exitCode = await runEmbeddingRemediationAuthorizationPacketCli(baseCliArgs(fixture), {
                loadCodeState: async () => fixture.codeState,
                link,
                writeError: vi.fn(),
            });

            expect(exitCode).toBe(3);
            await expect(readFile(packetPath)).rejects.toMatchObject({ code: 'ENOENT' });
            expect(await readFile(checksumsPath, 'utf8')).toBe(foreignChecksum);
        } finally {
            await rm(fixture.dir, { recursive: true, force: true });
        }
    });

    it('never unlinks a final path when it is replaced after ownership stat', async () => {
        const fixture = await writeFixtureDirectory(validRawInput());
        const packetPath = path.join(fixture.dir, 'authorization-packet.md');
        const checksumsPath = path.join(fixture.dir, 'SHA256SUMS');
        const foreignChecksum = 'foreign after stat\n';
        const unlink = vi.fn(unlinkFile);
        let replaced = false;
        const stat = vi.fn(async (filePath: Parameters<typeof statFile>[0]) => {
            const value = await statFile(filePath);
            if (String(filePath) === checksumsPath && !replaced) {
                replaced = true;
                await unlinkFile(checksumsPath);
                await writeFile(checksumsPath, foreignChecksum);
            }
            return value;
        });
        const link = vi.fn(async (source: string, destination: string) => {
            if (destination === packetPath) throw new Error('packet publication failed');
            await linkFile(source, destination);
        });

        try {
            const exitCode = await runEmbeddingRemediationAuthorizationPacketCli(baseCliArgs(fixture), {
                loadCodeState: async () => fixture.codeState,
                link,
                stat: stat as typeof statFile,
                unlink,
                writeError: vi.fn(),
            });

            expect(exitCode).toBe(3);
            expect(await readFile(checksumsPath, 'utf8')).toBe(foreignChecksum);
            expect(unlink).not.toHaveBeenCalledWith(checksumsPath);
        } finally {
            await rm(fixture.dir, { recursive: true, force: true });
        }
    });

    it('fails when the published checksum is replaced while the packet link succeeds', async () => {
        const fixture = await writeFixtureDirectory(validRawInput());
        const packetPath = path.join(fixture.dir, 'authorization-packet.md');
        const checksumsPath = path.join(fixture.dir, 'SHA256SUMS');
        const foreignChecksum = 'foreign during packet publication\n';
        const link = vi.fn(async (source: string, destination: string) => {
            if (destination === packetPath) {
                await unlinkFile(checksumsPath);
                await writeFile(checksumsPath, foreignChecksum);
            }
            await linkFile(source, destination);
        });

        try {
            const exitCode = await runEmbeddingRemediationAuthorizationPacketCli(baseCliArgs(fixture), {
                loadCodeState: async () => fixture.codeState,
                link,
                writeError: vi.fn(),
            });

            expect(exitCode).toBe(3);
            expect(await readFile(checksumsPath, 'utf8')).toBe(foreignChecksum);
            expect(await readFile(packetPath, 'utf8')).toContain('CODE_AND_DRY_RUN_READY');
        } finally {
            await rm(fixture.dir, { recursive: true, force: true });
        }
    });

    it.each(['authorization-packet.md', 'SHA256SUMS'])('refuses to overwrite stale %s', async (name) => {
        const fixture = await writeFixtureDirectory(validRawInput());
        const stalePath = path.join(fixture.dir, name);
        const sentinel = `stale:${name}\n`;
        await writeFile(stalePath, sentinel);
        const write = vi.fn(writeFile);
        const link = vi.fn(linkFile);
        const writeError = vi.fn();

        try {
            const exitCode = await runEmbeddingRemediationAuthorizationPacketCli(baseCliArgs(fixture), {
                loadCodeState: async () => fixture.codeState,
                writeFile: write,
                link,
                writeError,
            });

            expect(exitCode).toBe(3);
            expect(await readFile(stalePath, 'utf8')).toBe(sentinel);
            expect(write).toHaveBeenCalledTimes(1);
            expect(String(write.mock.calls[0][0])).toContain('.render.lock');
            expect(link).not.toHaveBeenCalled();
            expect(writeError).toHaveBeenCalledWith(expect.stringContaining('embedding_authorization_output_exists'));
        } finally {
            await rm(fixture.dir, { recursive: true, force: true });
        }
    });

    it('preserves an existing invocation lock and reports the renderer as busy', async () => {
        const fixture = await writeFixtureDirectory(validRawInput());
        const lockPath = path.join(fixture.dir, '.authorization-packet.md.render.lock');
        const sentinel = 'active renderer\n';
        await writeFile(lockPath, sentinel, { flag: 'wx' });
        const read = vi.fn(readFile);
        const loadCodeState = vi.fn(async () => fixture.codeState);
        const writeError = vi.fn();

        try {
            const exitCode = await runEmbeddingRemediationAuthorizationPacketCli(baseCliArgs(fixture), {
                readFile: read,
                loadCodeState,
                writeError,
            });

            expect(exitCode).toBe(3);
            expect(await readFile(lockPath, 'utf8')).toBe(sentinel);
            expect(read).not.toHaveBeenCalled();
            expect(loadCodeState).not.toHaveBeenCalled();
            expect(writeError).toHaveBeenCalledWith(
                expect.stringContaining('embedding_authorization_output_busy'),
            );
        } finally {
            await rm(fixture.dir, { recursive: true, force: true });
        }
    });

    it.each([
        ['outputs collide', (fixture: Awaited<ReturnType<typeof writeFixtureDirectory>>) => [
            '--packet-output', path.join(fixture.dir, 'same-output'),
            '--checksums-output', path.join(fixture.dir, 'same-output'),
        ]],
        ['packet overwrites proposal', (fixture: Awaited<ReturnType<typeof writeFixtureDirectory>>) => [
            '--packet-output', path.join(fixture.dir, 'proposal.json'),
        ]],
    ])('rejects path conflicts before I/O when %s', async (_name, conflictArgs) => {
        const fixture = await writeFixtureDirectory(validRawInput());
        const read = vi.fn(readFile);
        const write = vi.fn(writeFile);
        const link = vi.fn(linkFile);
        const unlink = vi.fn(unlinkFile);
        const fileExists = vi.fn(async () => false);
        const loadCodeState = vi.fn(async () => fixture.codeState);
        const writeError = vi.fn();

        try {
            const exitCode = await runEmbeddingRemediationAuthorizationPacketCli([
                ...baseCliArgs(fixture),
                ...conflictArgs(fixture),
            ], {
                readFile: read,
                writeFile: write,
                link,
                unlink,
                fileExists,
                loadCodeState,
                writeError,
            });

            expect(exitCode).toBe(3);
            expect(read).not.toHaveBeenCalled();
            expect(write).not.toHaveBeenCalled();
            expect(link).not.toHaveBeenCalled();
            expect(unlink).not.toHaveBeenCalled();
            expect(fileExists).not.toHaveBeenCalled();
            expect(loadCodeState).not.toHaveBeenCalled();
            expect(writeError).toHaveBeenCalledWith(expect.stringContaining('embedding_authorization_output_path_conflict'));
        } finally {
            await rm(fixture.dir, { recursive: true, force: true });
        }
    });
});

function validRawInput(
    codeState: EmbeddingRemediationCodeState = fixtureCodeState(),
): EmbeddingRemediationAuthorizationPacketRawInput {
    const codeStateDigest = computeEmbeddingRemediationCodeStateDigest(codeState);
    const proposal = validProposal();
    const proposalRaw = jsonRaw(proposal);
    const releaseScriptRaw = Buffer.from(CANONICAL_RELEASE_SCRIPT_RAW);
    return {
        ...codeState,
        proposalRaw,
        deterministicChecksRaw: jsonRaw(validChecks(codeStateDigest, releaseScriptRaw)),
        dispatchEvidenceRaw: jsonRaw(validDispatchEvidence(codeStateDigest)),
        proposalReviewRaw: jsonRaw(validProposalReview(proposal, proposalRaw, codeStateDigest)),
        operatorEvidencePath: '/evidence/operator-read-only.json',
        operatorEvidenceRaw: jsonRaw(validOperatorEvidence()),
        releaseScriptRaw,
    };
}

function fixtureCodeState(): EmbeddingRemediationCodeState {
    return {
        gitSha: '1'.repeat(40),
        branch: 'codex/recommendation-phase-0-gates',
        worktreeStatus: ' M telegram-clone-backend/src/example.ts\n?? notes.txt',
        trackedDiffRaw: Buffer.from('diff --git a/example.ts b/example.ts\n'),
        untracked: [{ path: 'notes.txt', raw: Buffer.from('review note\n') }],
    };
}

function fixtureCodeStateDigest(input: EmbeddingRemediationAuthorizationPacketRawInput): string {
    return computeEmbeddingRemediationCodeStateDigest({
        gitSha: input.gitSha,
        branch: input.branch,
        worktreeStatus: input.worktreeStatus,
        trackedDiffRaw: input.trackedDiffRaw,
        untracked: input.untracked,
    });
}

function validProposal(): EmbeddingContractRepairProposal {
    return withProposalDigest({
        schemaVersion: 1,
        mode: 'dry-run',
        fullScan: true,
        scanned: { users: 0, postFeatureSnapshots: 0 },
        evidence: {
            aggregate: evidenceSummary(),
            cohorts: {
                userVectors: evidenceSummary(),
                postFeatureSnapshots: evidenceSummary(),
            },
        },
        replay: {
            user: { matched: 0, mismatched: 0, inputMissing: 0 },
            post: { matched: 0, mismatched: 0 },
        },
        operations: [],
        corpusStateDigest: 'a'.repeat(64),
        quarantineDigest: 'b'.repeat(64),
        writeCounters: { mongo: 0, redis: 0, scheduler: 0, process: 0, python: 0 },
    });
}

function validOperatorEvidence() {
    return {
        schemaVersion: 1,
        reviewedBy: 'release-operator',
        reviewedAt: '2026-07-01T00:00:00.000Z',
        expiresAt: '2099-07-01T00:00:00.000Z',
        database: 'telegram',
        role: 'read',
        mongodbUriSha256: 'd'.repeat(64),
    };
}

function withProposalDigest(
    value: EmbeddingContractRepairProposalInput | EmbeddingContractRepairProposal,
): EmbeddingContractRepairProposal {
    const { proposalDigest: _ignored, ...input } = value as EmbeddingContractRepairProposal;
    return {
        ...input,
        proposalDigest: computeProposalDigest(input),
    };
}

function evidenceSummary(overrides: Record<string, number> = {}) {
    return {
        total: 0,
        verified_local_fallback: 0,
        semantic_ready: 0,
        quarantined: 0,
        invalid: 0,
        unclassified: 0,
        ...overrides,
    };
}

function validChecks(codeStateDigest: string, releaseScriptRaw: Buffer) {
    const check = (command: string) => ({ command, exit: 0, finishedAt: FINISHED_AT });
    return {
        schemaVersion: 1,
        codeStateDigest,
        nodeGate: {
            ...check(TASK8_NODE_GATE_COMMAND),
            testFiles: [...TASK8_NODE_GATE_TEST_FILES],
        },
        task4FocusedVitest: check(TASK4_FOCUSED_VITEST_COMMAND),
        packetRendererVitest: check(TASK8_PACKET_RENDERER_VITEST_COMMAND),
        backendTsc: check(BACKEND_TSC_COMMAND),
        releaseShellSyntax: check(RELEASE_SHELL_SYNTAX_COMMAND),
        releaseForbiddenScan: check(RELEASE_FORBIDDEN_SCAN_COMMAND),
        diffCheck: check(DIFF_CHECK_COMMAND),
        mlServicesDiffLines: [],
        mlServicesStatusLines: [],
        releaseScriptSha256: sha256(releaseScriptRaw),
    };
}

function validProposalReview(
    proposal: EmbeddingContractRepairProposal,
    proposalRaw: Buffer,
    codeStateDigest: string,
) {
    return {
        schemaVersion: 1,
        decision: 'APPROVED_FOR_AUTHORIZATION_REQUEST',
        productionAuthorization: 'NOT_GRANTED',
        reviewer: {
            agentId: '/root/task8_proposal_reviewer',
            model: 'gpt-5.6-sol',
            reasoningEffort: 'ultra',
        },
        reviewedAt: FINISHED_AT,
        proposalFileSha256: sha256(proposalRaw),
        proposalDigest: proposal.proposalDigest,
        quarantineDigest: proposal.quarantineDigest,
        corpusStateDigest: proposal.corpusStateDigest,
        fullScan: true,
        codeStateDigest,
    };
}

function validDispatchEvidence(codeStateDigest: string) {
    const row = (
        task: number,
        role: string,
        agentId: string,
        finishedAt = FINISHED_AT,
    ) => ({
        task,
        role,
        agentId,
        model: 'gpt-5.6-sol',
        reasoningEffort: 'ultra',
        status: 'DONE',
        finishedAt,
    });
    const standardRoles = (task: number) => [
        row(task, 'implementer', `/root/task${task}_implementer`),
        row(task, 'spec_reviewer', `/root/task${task}_spec_reviewer`),
        row(task, 'quality_reviewer', `/root/task${task}_quality_reviewer`),
    ];
    return {
        schemaVersion: 1,
        codeStateDigest,
        dispatches: [
            ...standardRoles(4),
            ...standardRoles(5),
            ...standardRoles(6),
            ...standardRoles(7),
            ...standardRoles(8),
            row(8, 'proposal_reviewer', '/root/task8_proposal_reviewer'),
            row(8, 'final_reviewer', '/root/task8_final_reviewer', '2026-07-13T00:01:00.000Z'),
        ],
    };
}

function validBaseline(
    input: EmbeddingRemediationAuthorizationPacketRawInput,
    overrides: Record<string, unknown> = {},
) {
    const proposal = proposalFrom(input);
    const userVectors = evidenceSummary({ total: 2, verified_local_fallback: 2 });
    const postFeatureSnapshots = evidenceSummary({ total: 1, invalid: 1 });
    return {
        strict: true,
        diagnosticOnly: false,
        releasePass: false,
        quarantineApproval: 'matched',
        auditMongoEvidence: {
            evidenceFile: input.operatorEvidencePath,
            evidenceFileSha256: sha256(input.operatorEvidenceRaw),
            meaning: 'operator_review_only',
        },
        embeddingEvidence: {
            ...evidenceSummary({ total: 3, verified_local_fallback: 2, invalid: 1 }),
            cohorts: { userVectors, postFeatureSnapshots },
            quarantineDigest: proposal.quarantineDigest,
            scan: {
                userDocuments: 1,
                postFeatureSnapshots: 1,
                mode: 'full',
                limit: null,
                diagnosticOnly: false,
                ordering: '_id_ascending',
            },
        },
        ...overrides,
    };
}

function proposalFrom(input: EmbeddingRemediationAuthorizationPacketRawInput) {
    return parseJson<EmbeddingContractRepairProposal>(input.proposalRaw);
}

async function writeFixtureDirectory(input: EmbeddingRemediationAuthorizationPacketRawInput) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'embedding-authorization-packet-'));
    const evidencePath = path.join(dir, 'operator-evidence.json');
    const releaseScriptPath = path.join(dir, 'verify_all.sh');
    await Promise.all([
        writeFile(path.join(dir, 'proposal.json'), input.proposalRaw),
        writeFile(path.join(dir, 'deterministic-checks.json'), input.deterministicChecksRaw),
        writeFile(path.join(dir, 'dispatch-evidence.json'), input.dispatchEvidenceRaw),
        writeFile(path.join(dir, 'proposal-review.json'), input.proposalReviewRaw),
        writeFile(evidencePath, input.operatorEvidenceRaw),
        writeFile(releaseScriptPath, input.releaseScriptRaw),
    ]);
    return {
        dir,
        evidencePath,
        releaseScriptPath,
        codeState: {
            gitSha: input.gitSha,
            branch: input.branch,
            worktreeStatus: input.worktreeStatus,
            trackedDiffRaw: input.trackedDiffRaw,
            untracked: input.untracked,
        },
    };
}

function baseCliArgs(fixture: Awaited<ReturnType<typeof writeFixtureDirectory>>) {
    return [
        '--artifacts-dir', fixture.dir,
        '--operator-evidence-file', fixture.evidencePath,
        '--release-script', fixture.releaseScriptPath,
    ];
}

function jsonRaw(value: unknown): Buffer {
    return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function parseJson<T>(raw: Buffer): T {
    return JSON.parse(raw.toString('utf8')) as T;
}

function sha256(value: crypto.BinaryLike): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}
