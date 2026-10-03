import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

// Public library code only. The worker receives document bytes from the client;
// this route never reads family storage or accepts an arbitrary filesystem path.
export async function GET() {
  const worker = await readFile(path.join(process.cwd(), "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"));
  return new Response(worker, { headers: {
    "Content-Type": "text/javascript; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
    "X-Content-Type-Options": "nosniff",
  } });
}
