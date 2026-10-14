/** Failure-only operational metadata. Provider content and arbitrary errors never
 * enter this channel; the association cannot be forged with Error properties. */
const reasons = {
  preflight: ["UNAVAILABLE", "INVALID_AUDIO", "INVALID_VOCABULARY"],
  transport: ["REQUEST_FAILED"],
  http: ["HTTP_ERROR"],
  response: ["EMPTY_BODY", "READ_FAILED", "TOO_LARGE", "INVALID_JSON", "INVALID_SHAPE"],
  transcript: ["INVALID_TEXT"],
  timeout: ["TIMEOUT"],
  service: ["UNEXPECTED_FAILURE", "SETTLEMENT_FAILED"],
} as const;
type Stage = keyof typeof reasons;
type Reason = typeof reasons[Stage][number];
type Metadata = Readonly<{ stage: Stage; reason: Reason; httpStatus?: number }>;
const failures = new WeakMap<object, Metadata>();
const fallback: Metadata = Object.freeze({ stage: "service", reason: "UNEXPECTED_FAILURE" });

export function transcriptionFailure(stage: Stage, reason: Reason, httpStatus?: number): Error {
  const error = new Error("Transcription provider unavailable");
  const valid = Object.hasOwn(reasons, stage) && (reasons[stage] as readonly string[]).includes(reason);
  failures.set(error, valid ? Object.freeze({ stage, reason,
    ...(stage === "http" && Number.isInteger(httpStatus) && httpStatus! >= 100 && httpStatus! <= 599 ? { httpStatus } : {}) }) : fallback);
  return error;
}

export function transcriptionFailureMetadata(error: unknown): Metadata {
  return error !== null && (typeof error === "object" || typeof error === "function") ? failures.get(error) ?? fallback : fallback;
}

export function reportTranscriptionFailure(transcriptionId: string, error: unknown, actual: unknown): void {
  // This logger is deliberately outside the success path. Even a broken logger
  // must not change the public response, settlement or retry behaviour.
  try {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(transcriptionId)) return;
    const { stage, reason, httpStatus } = transcriptionFailureMetadata(error);
    console.warn(JSON.stringify({ event: "hestia.transcription.failed", transcriptionId, stage, reason,
      ...(httpStatus === undefined ? {} : { httpStatus }),
      costKnown: typeof actual === "number" && Number.isSafeInteger(actual) && actual >= 0 }));
  } catch { /* Operational logging is best effort; never affect the operation. */ }
}
