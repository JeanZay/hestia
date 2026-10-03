import { spawn } from "node:child_process";
import path from "node:path";

export const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;
const TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
export class FormatValidationError extends Error {
  constructor(readonly code: "invalid_file" | "unsupported_type" | "file_too_large" | "validation_unavailable") {
    super(code);
    this.name = "FormatValidationError";
  }
}
let active = 0;

/** Decode in a disposable process: parser crash/timeouts cannot hang the application event loop. */
export async function validateOriginal(bytes: Uint8Array, declaredType: string): Promise<{ mediaType: string; previewSupported: boolean }> {
  if (!bytes.byteLength) throw new FormatValidationError("invalid_file");
  if (bytes.byteLength > MAX_ORIGINAL_BYTES) throw new FormatValidationError("file_too_large");
  if (!TYPES.has(declaredType)) throw new FormatValidationError("unsupported_type");
  // No unbounded queue of retained 20 MiB buffers when all decoder slots are busy.
  if (active >= 2) throw new FormatValidationError("validation_unavailable");
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const worker = spawn(process.execPath, ["--max-old-space-size=256", path.join(process.cwd(), "src/server/formats/validate-worker.mjs"), declaredType], {
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
        // Do not pass database/S3 credentials, NODE_OPTIONS or arbitrary loaders to an untrusted parser.
        env: { NODE_ENV: "production", PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP },
      });
      let output = "";
      let expired = false;
      const timer = setTimeout(() => { expired = true; worker.kill(); }, 15_000);
      worker.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
        if (output.length > 1024) worker.kill();
      });
      worker.stdin.on("error", () => { /* premature parser rejection closes the pipe */ });
      worker.once("error", () => { clearTimeout(timer); reject(new FormatValidationError("validation_unavailable")); });
      worker.once("close", code => {
        clearTimeout(timer);
        if (expired) return reject(new FormatValidationError("invalid_file"));
        if (code !== 0) return reject(new FormatValidationError(code === 2 ? "validation_unavailable" : "invalid_file"));
        try {
          const result = JSON.parse(output) as { mediaType: string; previewSupported: boolean };
          if (!TYPES.has(result.mediaType) || typeof result.previewSupported !== "boolean") throw new Error();
          resolve(result);
        } catch { reject(new FormatValidationError("invalid_file")); }
      });
      worker.stdin.end(bytes);
    });
  } finally { active--; }
}
