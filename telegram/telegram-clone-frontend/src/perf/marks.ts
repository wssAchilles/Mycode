const isBrowser = typeof window !== 'undefined' && typeof performance !== 'undefined';
const measuredChatSwitches = new Set<string>();
let lastSyncPhase: string | null = null;

function safeMark(name: string) {
  if (!isBrowser) return;
  try {
    performance.mark(name);
  } catch {
    // ignore
  }
}

function safeMeasure(name: string, startMark: string, endMark: string) {
  if (!isBrowser) return;
  try {
    const measure = performance.measure(name, startMark, endMark);
    // eslint-disable-next-line no-console
    console.log('[perf]', name, Math.round(measure.duration), 'ms');
  } catch {
    // ignore
  }
}

export function markChatSwitchStart(chatId: string, loadSeq: number) {
  measuredChatSwitches.delete(`${chatId}:${loadSeq}`);
  safeMark(`chat_switch_start:${chatId}:${loadSeq}`);
}

export function markChatSwitchEnd(chatId: string, loadSeq: number) {
  const key = `${chatId}:${loadSeq}`;
  if (measuredChatSwitches.has(key)) return;
  measuredChatSwitches.add(key);

  const start = `chat_switch_start:${chatId}:${loadSeq}`;
  const end = `chat_switch_end:${chatId}:${loadSeq}`;
  safeMark(end);
  safeMeasure('chat_switch', start, end);
}

export function markWorkerRecoverStart(generation: number) {
  safeMark(`chat_worker_recover_start:${generation}`);
}

export function markWorkerRecoverEnd(generation: number) {
  const start = `chat_worker_recover_start:${generation}`;
  const end = `chat_worker_recover_end:${generation}`;
  safeMark(end);
  safeMeasure('chat_worker_recover', start, end);
}

export function markSyncPhaseTransition(phase: string, reason?: string) {
  if (!isBrowser) return;
  if (lastSyncPhase === phase) return;
  lastSyncPhase = phase;

  const markName = `chat_sync_phase:${phase}`;
  safeMark(markName);
  // eslint-disable-next-line no-console
  console.log('[perf] chat_sync_phase', phase, reason || '');
}
