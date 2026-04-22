import { cleanupDemoCohort, collectExistingDemoState } from './cohortStore';
import { connectDemoStores, disconnectDemoStores } from './runtime';

async function main(): Promise<void> {
  await connectDemoStores();
  try {
    const state = await collectExistingDemoState();
    await cleanupDemoCohort(state);
    console.log('[demo:reset] removed demo cohort');
    console.log(`  users: ${state.demoUserIds.length}`);
    console.log(`  groups: ${state.demoGroupIds.length}`);
    console.log(`  posts: ${state.demoPostIds.length}`);
  } finally {
    await disconnectDemoStores();
  }
}

main().catch(async (error) => {
  console.error('[demo:reset] failed:', error);
  await disconnectDemoStores();
  process.exit(1);
});
