import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

/** Server-only byte transport. Authorization and immutable key allocation belong to SQL operations. */
export interface ObjectStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  getRange(key: string, start: number, endInclusive: number): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

export type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  mode: "local" | "remote";
  bucketAccess: "private";
  timeoutMs?: number;
};

export class StorageError extends Error {
  constructor(readonly code: "storage_configuration" | "storage_unavailable" | "invalid_storage_request") {
    super(code);
    this.name = "StorageError";
  }
}

export function storageConfigFromEnv(env: Record<string, string | undefined> = process.env): StorageConfig {
  return validateStorageConfig({
    endpoint: env.AWS_ENDPOINT_URL_S3 ?? "",
    region: env.AWS_REGION ?? "",
    bucket: env.HESTIA_S3_BUCKET ?? "",
    accessKeyId: env.AWS_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY ?? "",
    mode: env.HESTIA_STORAGE_MODE as StorageConfig["mode"],
    bucketAccess: env.HESTIA_S3_BUCKET_ACCESS as "private",
  });
}

export function validateStorageConfig(input: StorageConfig): StorageConfig {
  const fail = () => { throw new StorageError("storage_configuration"); };
  if (input.mode !== "local" && input.mode !== "remote") fail();
  if (input.bucketAccess !== "private") fail();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(input.bucket) || input.bucket.includes("..")) fail();
  if (!/^[a-z0-9-]{1,64}$/.test(input.region)) fail();
  if (!input.accessKeyId?.trim() || !input.secretAccessKey?.trim()) fail();
  let url: URL;
  try { url = new URL(input.endpoint); } catch { return fail(); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") fail();
  if (input.mode === "local") {
    // No DNS resolution, inherited cloud endpoint, redirect or hostname alias can target a remote service.
    if (!["127.0.0.1", "[::1]"].includes(url.hostname) || !["http:", "https:"].includes(url.protocol)) fail();
  } else if (url.protocol !== "https:") fail();
  const timeoutMs = input.timeoutMs ?? 15_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) fail();
  return { ...input, endpoint: url.origin, timeoutMs };
}

const MAX_OBJECT = 20 * 1024 * 1024;
const MAX_RANGE = 2 * 1024 * 1024;
function validateKey(key: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,255}$/.test(key) || key.includes("//")) {
    throw new StorageError("invalid_storage_request");
  }
}

export function createS3Storage(config: StorageConfig = storageConfigFromEnv()): ObjectStore {
  const validated = validateStorageConfig(config);
  const client = new S3Client({
    endpoint: validated.endpoint,
    region: validated.region,
    credentials: { accessKeyId: validated.accessKeyId, secretAccessKey: validated.secretAccessKey },
    forcePathStyle: true,
    maxAttempts: 1,
    followRegionRedirects: false,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: { connectionTimeout: 3_000, requestTimeout: validated.timeoutMs },
  });
  async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new StorageError("storage_unavailable")); }, validated.timeoutMs);
    });
    try { return await Promise.race([operation(controller.signal), timeout]); }
    catch { throw new StorageError("storage_unavailable"); }
    finally { clearTimeout(timer!); }
  }
  return {
    async put(key, bytes, contentType) {
      validateKey(key);
      if (!bytes.byteLength || bytes.byteLength > MAX_OBJECT || !/^[a-z]+\/[a-z0-9.+-]+$/.test(contentType)) {
        throw new StorageError("invalid_storage_request");
      }
      // Callers allocate fresh keys under their SQL operation lease. Neon is not WORM;
      // no unsupported conditional-write guarantee is inferred from AWS behavior.
      await bounded(signal => client.send(new PutObjectCommand({
        Bucket: validated.bucket, Key: key, Body: bytes, ContentLength: bytes.byteLength,
        ContentType: contentType, CacheControl: "private, no-store",
      }), { abortSignal: signal }));
    },
    async getRange(key, start, endInclusive) {
      validateKey(key);
      const length = endInclusive - start + 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(endInclusive) || start < 0 ||
        length < 1 || length > MAX_RANGE || endInclusive >= MAX_OBJECT) {
        throw new StorageError("invalid_storage_request");
      }
      return bounded(async signal => {
        const response = await client.send(new GetObjectCommand({
          Bucket: validated.bucket, Key: key, Range: `bytes=${start}-${endInclusive}`,
        }), { abortSignal: signal });
        const body = response.Body;
        if (!body) throw new Error("missing body");
        const abortBody = () => (body as { destroy?: (error?: Error) => void }).destroy?.(new Error("storage timeout"));
        signal.addEventListener("abort", abortBody, { once: true });
        // Check headers before reading; never accept a server ignoring Range.
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.ContentRange ?? "");
        if (response.$metadata.httpStatusCode !== 206 || response.ContentLength !== length || !range ||
          Number(range[1]) !== start || Number(range[2]) !== endInclusive || Number(range[3]) <= endInclusive ||
          Number(range[3]) > MAX_OBJECT) {
          (body as { destroy?: () => void }).destroy?.();
          signal.removeEventListener("abort", abortBody);
          throw new Error("invalid range response");
        }
        const output = new Uint8Array(length);
        let offset = 0;
        try {
          for await (const chunk of body as AsyncIterable<Uint8Array>) {
            if (signal.aborted || offset + chunk.byteLength > length) throw new Error("invalid body");
            output.set(chunk, offset);
            offset += chunk.byteLength;
          }
          if (offset !== length) throw new Error("short body");
          return output;
        } finally {
          signal.removeEventListener("abort", abortBody);
          (body as { destroy?: () => void }).destroy?.();
        }
      });
    },
    async delete(key) {
      validateKey(key);
      await bounded(signal => client.send(new DeleteObjectCommand({ Bucket: validated.bucket, Key: key }), { abortSignal: signal }));
    },
  };
}

export const createObjectStore = createS3Storage;
