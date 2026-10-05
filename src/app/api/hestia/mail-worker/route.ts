import { runApplicationMail } from "@/server/runtime";
import { handleMailWorker } from "@/server/identity/worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export function POST(request: Request) {
  return handleMailWorker(request, process.env.MAIL_WORKER_SECRET, runApplicationMail);
}
