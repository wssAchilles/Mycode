/**
 * DOM read/write separation system inspired by Telegram-TT.
 *
 * In one animation frame, all DOM reads (requestMeasure) are flushed first,
 * then all DOM writes (requestMutation).  This avoids forced synchronous
 * layout (reflow) that browsers trigger when reads and writes are interleaved.
 */

let pendingMeasure: Array<() => void> = [];
let pendingMutation: Array<() => void> = [];
let scheduled = false;

function flush() {
  scheduled = false;
  const measures = pendingMeasure.splice(0);
  const mutations = pendingMutation.splice(0);
  measures.forEach((cb) => cb());
  mutations.forEach((cb) => cb());
}

function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(flush);
}

/** Schedule a DOM read (measure) to run at the start of the next frame. */
export function requestMeasure(cb: () => void): void {
  pendingMeasure.push(cb);
  schedule();
}

/** Schedule a DOM write (mutation) to run after all pending measures. */
export function requestMutation(cb: () => void): void {
  pendingMutation.push(cb);
  schedule();
}

/**
 * Special case: the callback performs a read and returns a write closure.
 * The read runs in the measure phase, the returned write runs in the
 * mutation phase — guaranteeing exactly one forced reflow.
 */
export function requestForcedReflow(measureCb: () => [() => void]): void {
  requestMeasure(() => {
    const [mutation] = measureCb();
    requestMutation(mutation);
  });
}
