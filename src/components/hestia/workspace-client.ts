/** Only the latest read may publish. Aborting is an optimization; the epoch is
 * also checked because a response can finish after fetch has been aborted. */
export class WorkspaceReader {
  private epoch = 0;
  private controller: AbortController | null = null;

  get revision() { return this.epoch; }
  get pending() { return this.controller !== null; }

  invalidate() {
    ++this.epoch;
    this.controller?.abort();
    this.controller = null;
  }

  async read<T>(load: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> {
    this.invalidate();
    const epoch = this.epoch;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const result = await load(controller.signal);
      return !controller.signal.aborted && epoch === this.epoch ? result : undefined;
    } catch (error) {
      if (!controller.signal.aborted && epoch === this.epoch) throw error;
      return undefined;
    } finally {
      if (epoch === this.epoch) this.controller = null;
    }
  }
}

/** Focus, pageshow and visibilitychange describe the same return to the app.
 * A short trailing window folds that burst into one passive read. */
export function coalesceWorkspaceRefresh(run: () => void, delay = 80) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(() => { timer = undefined; run(); }, delay);
    },
    cancel() { clearTimeout(timer); timer = undefined; },
  };
}
