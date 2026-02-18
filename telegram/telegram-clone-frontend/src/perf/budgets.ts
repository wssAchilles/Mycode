export const perfBudgets = {
  chatSwitchP50Ms: 100,
  chatSwitchP95Ms: 200,
  historyPrependBatchSize: 50,
  historyFrameP95Ms: 18,
  longTaskThresholdMs: 50,
  workerRecoverP95Ms: 800,
  maxMainBundleKb: 550,
  maxWorkerBundleKb: 160,
  maxWasmBundleKb: 64,
} as const;

export const perfFeatureFlags = {
  enablePerfConsole: true,
  enableLongTaskWarnings: true,
} as const;
