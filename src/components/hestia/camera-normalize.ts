type WorkerPort = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror">;
type Job = { identity: object; file: File; signal: AbortSignal; resolve: (file: File) => void; reject: (reason: unknown) => void; cancel: () => void; worker?: WorkerPort; timer?: ReturnType<typeof setTimeout>; settled: boolean };

/** One active native decoder and at most one waiting selection per tab. The
 * original File remains untouched on unsupported formats/capabilities/errors. */
export function createCameraNormalizer(factory: () => WorkerPort, timeoutMs = 15_000) {
  let active: Job | undefined;
  const waiting: Job[] = [];
  const identities = new WeakMap<object, Promise<File>>();
  const finish = (job: Job, file?: File, error?: unknown) => {
    if (job.settled) return;
    job.settled = true; clearTimeout(job.timer); job.worker?.terminate();
    job.signal.removeEventListener("abort", job.cancel); identities.delete(job.identity);
    const position = waiting.indexOf(job); if (position >= 0) waiting.splice(position, 1);
    if (active === job) active = undefined;
    if (file) job.resolve(file); else job.reject(error ?? new DOMException("Aborted", "AbortError"));
    drain();
  };
  const drain = () => {
    if (active || !waiting.length) return;
    const job = waiting.shift()!; active = job;
    if (job.signal.aborted) { finish(job, undefined, job.signal.reason); return; }
    try {
      const worker = factory(); job.worker = worker;
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (job.settled || job.signal.aborted) return;
        const result = event.data as { blob?: unknown; width?: number; height?: number } | null;
        const blob = result?.blob;
        if (blob instanceof Blob && blob.type === "image/jpeg" && blob.size > 0 && blob.size < job.file.size && Number.isInteger(result?.width) && Number.isInteger(result?.height) && result!.width! > 0 && result!.height! > 0 && Math.max(result!.width!, result!.height!) <= 3200) {
          finish(job, new File([blob], job.file.name.replace(/\.[^.]*$/, "") + ".jpg", { type: "image/jpeg", lastModified: job.file.lastModified }));
        } else finish(job, job.file);
      };
      worker.onerror = worker.onmessageerror = () => finish(job, job.file);
      job.timer = setTimeout(() => finish(job, job.file), timeoutMs);
      worker.postMessage({ file: job.file });
    } catch { finish(job, job.file); }
  };
  return {
    normalize(file: File, signal: AbortSignal, identity: object): Promise<File> {
      if (signal.aborted) return Promise.reject(signal.reason);
      const existing = identities.get(identity); if (existing) return existing;
      if (!file.size || file.size > 20 * 1024 * 1024 || (!["image/jpeg", "image/png", "image/webp"].includes(file.type) && !(file.type === "" && /\.(?:jpe?g|png|webp)$/i.test(file.name))) || (active && waiting.length)) return Promise.resolve(file);
      let job!: Job;
      const promise = new Promise<File>((resolve, reject) => {
        job = { identity, file, signal, resolve, reject, settled: false, cancel: () => finish(job, undefined, signal.reason) };
      });
      identities.set(identity, promise); waiting.push(job);
      signal.addEventListener("abort", job.cancel, { once: true }); drain();
      return promise;
    },
    clear() {
      // Cancel queued jobs before the active one so finishing it cannot start
      // another decoder from the expired privacy generation.
      for (const job of [...waiting, ...(active ? [active] : [])]) finish(job);
    },
  };
}

export const cameraNormalizer = createCameraNormalizer(() => new Worker(new URL("./camera-normalize-worker.ts", import.meta.url), { type: "module" }));
