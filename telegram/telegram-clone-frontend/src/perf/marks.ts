const isBrowser = typeof window !== 'undefined' && typeof performance !== 'undefined';

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
  safeMark(`chat_switch_start:${chatId}:${loadSeq}`);
}

export function markChatSwitchEnd(chatId: string, loadSeq: number) {
  const start = `chat_switch_start:${chatId}:${loadSeq}`;
  const end = `chat_switch_end:${chatId}:${loadSeq}`;
  safeMark(end);
  safeMeasure('chat_switch', start, end);
}

