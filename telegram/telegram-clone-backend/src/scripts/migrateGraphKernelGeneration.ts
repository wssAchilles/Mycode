import mongoose from 'mongoose';

import {
  connectReadOnlyMongo,
  disconnectReadOnlyMongo,
} from '../services/recommendation/training/readOnlyMongo';
import { buildGraphGenerationMigrationDryRunPlan } from '../services/graphKernel/generation/migration';
import {
  GRAPH_GENERATION_INDEX_DEFINITIONS,
  type GraphGenerationIndexSnapshot,
  type GraphGenerationListIndex,
} from '../services/graphKernel/generation/repository';

export const GRAPH_GENERATION_MIGRATION_EXIT_OK = 0 as const;
export const GRAPH_GENERATION_MIGRATION_EXIT_ERROR = 3 as const;

interface GraphGenerationMigrationCliDependencies {
  writeJson: (value: unknown) => void;
  writeError: (message: string) => void;
  loadIndexSnapshot: () => Promise<GraphGenerationIndexSnapshot>;
  indexSnapshot?: GraphGenerationIndexSnapshot;
}

export function parseGraphGenerationMigrationArgs(
  argv: readonly string[],
): { mode: 'dry-run' } {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--dry-run')) {
    return { mode: 'dry-run' };
  }
  throw new Error('graph_generation_migration_dry_run_only');
}

export async function runGraphGenerationMigrationCli(
  argv: readonly string[],
  dependencyOverrides: Partial<GraphGenerationMigrationCliDependencies> = {},
): Promise<
  | typeof GRAPH_GENERATION_MIGRATION_EXIT_OK
  | typeof GRAPH_GENERATION_MIGRATION_EXIT_ERROR
> {
  const dependencies: GraphGenerationMigrationCliDependencies = {
    writeJson: (value) => console.log(JSON.stringify(value, null, 2)),
    writeError: (message) => console.error(message),
    loadIndexSnapshot: loadLiveIndexSnapshot,
    ...dependencyOverrides,
  };
  try {
    parseGraphGenerationMigrationArgs(argv);
    const plan = buildGraphGenerationMigrationDryRunPlan(
      new Date(),
      dependencies.indexSnapshot ?? await dependencies.loadIndexSnapshot(),
    );
    dependencies.writeJson(plan);
    if (plan.indexVerification.result.status !== 'ok') {
      dependencies.writeError('[GraphGenerationMigration] failed: graph_generation_index_mismatch');
      return GRAPH_GENERATION_MIGRATION_EXIT_ERROR;
    }
    return GRAPH_GENERATION_MIGRATION_EXIT_OK;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.writeError(`[GraphGenerationMigration] failed: ${message}`);
    return GRAPH_GENERATION_MIGRATION_EXIT_ERROR;
  }
}

async function loadLiveIndexSnapshot(): Promise<GraphGenerationIndexSnapshot> {
  await connectReadOnlyMongo();
  try {
    const database = mongoose.connection.db;
    if (!database) throw new Error('graph_generation_database_unavailable');
    const snapshot: GraphGenerationIndexSnapshot = {};
    for (const collection of new Set(
      GRAPH_GENERATION_INDEX_DEFINITIONS.map((definition) => definition.collection),
    )) {
      const exists = await database.listCollections({ name: collection }, { nameOnly: true })
        .hasNext();
      if (!exists) {
        snapshot[collection] = [];
        continue;
      }
      const indexes = await database.collection(collection).listIndexes().toArray();
      snapshot[collection] = indexes as unknown as GraphGenerationListIndex[];
    }
    return snapshot;
  } finally {
    await disconnectReadOnlyMongo();
  }
}

if (require.main === module) {
  runGraphGenerationMigrationCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
