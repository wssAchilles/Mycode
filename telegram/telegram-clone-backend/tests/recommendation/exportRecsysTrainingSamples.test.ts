import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  const write = vi.fn();
  const userActionFind = vi.fn();
  const userFindAll = vi.fn();
  const contactFindAll = vi.fn();
  const featureFind = vi.fn();
  const traceFind = vi.fn();
  const getSnapshotsByPostIds = vi.fn();
  const store = (reads: Record<string, unknown>) => ({
    ...reads,
    create: write,
    insertMany: write,
    bulkCreate: write,
    bulkWrite: write,
    update: write,
    updateOne: write,
    updateMany: write,
    findOneAndUpdate: write,
    findByIdAndUpdate: write,
    destroy: write,
    deleteOne: write,
    deleteMany: write,
    findOneAndDelete: write,
    findByIdAndDelete: write,
  });

  return {
    write,
    userActionFind,
    userFindAll,
    contactFindAll,
    featureFind,
    traceFind,
    getSnapshotsByPostIds,
    connectMongoDB: vi.fn(),
    disconnectMongoDB: vi.fn(),
    sequelize: {
      authenticate: vi.fn(),
      close: vi.fn(),
      query: write,
    },
    userAction: store({ find: userActionFind }),
    user: store({ findAll: userFindAll }),
    contact: store({ findAll: contactFindAll }),
    feature: store({ find: featureFind }),
    trace: store({ find: traceFind }),
    snapshots: {
      getSnapshotsByPostIds,
      ensureSnapshotsByPostIds: write,
    },
  };
});

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('../../src/config/db', () => ({
  connectMongoDB: runtime.connectMongoDB,
  disconnectMongoDB: runtime.disconnectMongoDB,
}));
vi.mock('../../src/config/sequelize', () => ({ sequelize: runtime.sequelize }));
vi.mock('../../src/models/Contact', () => ({
  default: runtime.contact,
  ContactStatus: { ACCEPTED: 'accepted' },
}));
vi.mock('../../src/models/RecommendationTrace', () => ({ default: runtime.trace }));
vi.mock('../../src/models/User', () => ({ default: runtime.user }));
vi.mock('../../src/models/UserFeatureVector', () => ({ default: runtime.feature }));
vi.mock('../../src/models/UserAction', () => ({
  default: runtime.userAction,
  ActionType: {
    IMPRESSION: 'impression',
    CLICK: 'click',
    LIKE: 'like',
    REPLY: 'reply',
    REPOST: 'repost',
    QUOTE: 'quote',
    SHARE: 'share',
    PROFILE_CLICK: 'profile_click',
    DWELL: 'dwell',
    VIDEO_QUALITY_VIEW: 'video_quality_view',
    DISMISS: 'dismiss',
    BLOCK_AUTHOR: 'block_author',
    REPORT: 'report',
  },
}));
vi.mock('../../src/services/recommendation/contentFeatures', () => ({
  postFeatureSnapshotService: runtime.snapshots,
}));

function query<T>(rows: T[]) {
  const cursor = {
    select: vi.fn(),
    sort: vi.fn(),
    limit: vi.fn(),
    lean: vi.fn().mockResolvedValue(rows),
  };
  cursor.select.mockReturnValue(cursor);
  cursor.sort.mockReturnValue(cursor);
  cursor.limit.mockReturnValue(cursor);
  return cursor;
}

describe('PIT-safe partial training exporter CLI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('runs the real exporter path without mutating a datastore', async () => {
    const decisionAt = '2026-05-01T12:00:00.000Z';
    const eventTime = new Date('2026-05-01T12:00:05.000Z');
    const postId = '507f191e810c19729de860ea';
    const sharedFixture = JSON.parse(readFileSync(path.resolve(
      __dirname,
      '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures/decision_log_v1.json',
    ), 'utf8'));
    const decisionLogV1 = {
      ...sharedFixture.decisionLog,
      decisionAt,
    };
    decisionLogV1.actions[0].actionKey.candidateId = postId;
    decisionLogV1.candidatePool.candidates[0].candidateId = postId;
    const { candidatePoolSha256, decisionLogSha256 } = await import(
      '../../src/services/recommendation/decisionLog/contracts'
    );
    decisionLogV1.candidatePool.candidatePoolSha256 = candidatePoolSha256(
      decisionLogV1.candidatePool.candidates,
    );
    runtime.traceFind.mockReturnValue(query([{
      requestId: decisionLogV1.requestId,
      decisionId: decisionLogV1.decisionId,
      decisionLogV1Sha256: decisionLogSha256(decisionLogV1),
      userId: 'user-1',
      productSurface: 'space_feed',
      decisionLogV1,
      candidates: [{
        postId,
        modelPostId: postId,
        authorId: 'author-1',
        rank: 1,
        recallSource: 'FollowingSource',
        inNetwork: true,
        isNews: false,
      }],
    }]));
    runtime.userActionFind
      .mockReturnValueOnce(query([{
        userId: 'user-1',
        requestId: decisionLogV1.requestId,
        action: 'impression',
        rank: 1,
        timestamp: eventTime,
        metadata: {
          decisionId: decisionLogV1.decisionId,
          candidateNamespace: 'serving_post_id',
          candidateId: postId,
          positionContractVersion: 'served_position_1_based_v1',
        },
      }]))
      .mockReturnValueOnce(query([]));
    runtime.userFindAll.mockResolvedValue([]);
    runtime.contactFindAll.mockResolvedValue([]);
    runtime.featureFind.mockReturnValue(query([]));
    runtime.getSnapshotsByPostIds.mockResolvedValue(new Map());

    const outputDirectory = mkdtempSync(path.join(tmpdir(), 'recsys-export-'));
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.argv = [
      'node',
      'exportRecsysTrainingSamples.ts',
      '--cutoff',
      '2026-05-03T12:00:00.000Z',
      '--output',
      path.join(outputDirectory, 'samples.ndjson'),
    ];
    process.exitCode = undefined;

    try {
      await import('../../src/scripts/exportRecsysTrainingSamples');
      await vi.waitFor(() => expect(runtime.sequelize.close).toHaveBeenCalledOnce());

      expect(runtime.connectMongoDB).toHaveBeenCalledWith({
        autoIndex: false,
        autoCreate: false,
        quiet: true,
      });
      expect(runtime.disconnectMongoDB).toHaveBeenCalledOnce();
      expect([
        runtime.userActionFind,
        runtime.userFindAll,
        runtime.contactFindAll,
        runtime.featureFind,
        runtime.getSnapshotsByPostIds,
        runtime.traceFind,
      ].map((read) => read.mock.calls.length)).toEqual([2, 1, 1, 1, 1, 1]);
      expect(runtime.userActionFind.mock.calls[0][0]).toMatchObject({
        'metadata.decisionId': { $in: [decisionLogV1.decisionId] },
      });
      expect(runtime.userActionFind.mock.calls[0][0]).not.toHaveProperty('targetPostId');
      expect(runtime.write).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
      expect(readdirSync(outputDirectory)).toHaveLength(7);
      expect(readdirSync(outputDirectory).map((file) => (
        statSync(path.join(outputDirectory, file)).mode & 0o777
      ))).toEqual(Array(7).fill(0o600));
      const row = JSON.parse(readFileSync(
        path.join(outputDirectory, 'samples.quarantine.ndjson'),
        'utf8',
      ));
      expect(row.pitEventTime).toBe(decisionAt);
      expect(row.impressionAt).toBe(eventTime.toISOString());
      expect(row.outcomeContractV1.status).toBe('observed');
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      error.mockRestore();
      log.mockRestore();
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a Decision Log binding mismatch before downstream reads', async () => {
    const sharedFixture = JSON.parse(readFileSync(path.resolve(
      __dirname,
      '../../../telegram-rust-workspace/crates/telegram-recommendation-fixtures/fixtures/decision_log_v1.json',
    ), 'utf8'));
    runtime.traceFind.mockReturnValue(query([{
      requestId: sharedFixture.decisionLog.requestId,
      decisionId: sharedFixture.decisionLog.decisionId,
      decisionLogV1Sha256: '0'.repeat(64),
      userId: 'user-1',
      productSurface: 'space_feed',
      decisionLogV1: sharedFixture.decisionLog,
      candidates: [],
    }]));

    const outputDirectory = mkdtempSync(path.join(tmpdir(), 'recsys-export-binding-'));
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.argv = [
      'node',
      'exportRecsysTrainingSamples.ts',
      '--cutoff',
      '2026-05-03T12:00:00.000Z',
      '--output',
      path.join(outputDirectory, 'samples.ndjson'),
    ];
    process.exitCode = undefined;

    try {
      await import('../../src/scripts/exportRecsysTrainingSamples');
      await vi.waitFor(() => expect(runtime.sequelize.close).toHaveBeenCalledOnce());

      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledWith(
        '[ExportRecsysSamples] failed:',
        expect.objectContaining({ message: 'training_export_source_binding_invalid' }),
      );
      expect(runtime.userActionFind).not.toHaveBeenCalled();
      expect(runtime.userFindAll).not.toHaveBeenCalled();
      expect(runtime.contactFindAll).not.toHaveBeenCalled();
      expect(runtime.featureFind).not.toHaveBeenCalled();
      expect(runtime.getSnapshotsByPostIds).not.toHaveBeenCalled();
      expect(readdirSync(outputDirectory)).toEqual([]);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      error.mockRestore();
      log.mockRestore();
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it('does not overwrite an existing artifact target', async () => {
    runtime.traceFind.mockReturnValue(query([]));
    const outputDirectory = mkdtempSync(path.join(tmpdir(), 'recsys-export-existing-'));
    const outputPath = path.join(outputDirectory, 'samples.ndjson');
    const existingPath = path.join(outputDirectory, 'samples.valid.ndjson');
    writeFileSync(existingPath, 'owner-data\n', 'utf8');
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.argv = [
      'node',
      'exportRecsysTrainingSamples.ts',
      '--cutoff',
      '2026-05-03T12:00:00.000Z',
      '--output',
      outputPath,
    ];
    process.exitCode = undefined;

    try {
      await import('../../src/scripts/exportRecsysTrainingSamples');
      await vi.waitFor(() => expect(error).toHaveBeenCalled());

      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledWith(
        '[ExportRecsysSamples] failed:',
        expect.objectContaining({ message: 'training_export_target_exists' }),
      );
      expect(readFileSync(existingPath, 'utf8')).toBe('owner-data\n');
      expect(readdirSync(outputDirectory)).toEqual(['samples.valid.ndjson']);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      error.mockRestore();
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });

  it('rejects an invalid resource limit before opening MongoDB', async () => {
    const outputDirectory = mkdtempSync(path.join(tmpdir(), 'recsys-export-limit-'));
    const originalArgv = process.argv;
    const originalExitCode = process.exitCode;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    process.argv = [
      'node',
      'exportRecsysTrainingSamples.ts',
      '--cutoff',
      '2026-05-03T12:00:00.000Z',
      '--limit',
      '0',
      '--output',
      path.join(outputDirectory, 'samples.ndjson'),
    ];
    process.exitCode = undefined;

    try {
      await import('../../src/scripts/exportRecsysTrainingSamples');
      await vi.waitFor(() => expect(error).toHaveBeenCalled());

      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledWith(
        '[ExportRecsysSamples] failed:',
        expect.objectContaining({ message: 'training_export_argument_invalid' }),
      );
      expect(runtime.connectMongoDB).not.toHaveBeenCalled();
      expect(runtime.traceFind).not.toHaveBeenCalled();
      expect(readdirSync(outputDirectory)).toEqual([]);
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      error.mockRestore();
      rmSync(outputDirectory, { recursive: true, force: true });
    }
  });
});
