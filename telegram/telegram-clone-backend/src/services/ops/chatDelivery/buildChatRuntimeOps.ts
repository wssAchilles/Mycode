import { chatRuntimeMetrics } from '../../chatRuntimeMetrics';

export function buildChatRuntimeOps() {
  return chatRuntimeMetrics.snapshot();
}

export function resetChatRuntimeOps() {
  chatRuntimeMetrics.reset();
  return {
    reset: true,
    at: new Date().toISOString(),
  };
}
