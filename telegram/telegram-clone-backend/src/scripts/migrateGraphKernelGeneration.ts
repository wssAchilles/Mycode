import { buildGraphGenerationMigrationDryRunPlan } from '../services/graphKernel/generation/migration';
import type { GraphGenerationIndexSnapshot } from '../services/graphKernel/generation/repository';

export const GRAPH_GENERATION_MIGRATION_EXIT_OK = 0 as const;
export const GRAPH_GENERATION_MIGRATION_EXIT_ERROR = 3 as const;

interface GraphGenerationMigrationCliDependencies {
  writeJson: (value: unknown) => void;
  writeError: (message: string) => void;
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
    ...dependencyOverrides,
  };
  try {
    parseGraphGenerationMigrationArgs(argv);
    dependencies.writeJson(buildGraphGenerationMigrationDryRunPlan(
      new Date(),
      dependencies.indexSnapshot,
    ));
    return GRAPH_GENERATION_MIGRATION_EXIT_OK;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.writeError(`[GraphGenerationMigration] failed: ${message}`);
    return GRAPH_GENERATION_MIGRATION_EXIT_ERROR;
  }
}

if (require.main === module) {
  runGraphGenerationMigrationCli(process.argv.slice(2)).then((exitCode) => {
    process.exitCode = exitCode;
  });
}
