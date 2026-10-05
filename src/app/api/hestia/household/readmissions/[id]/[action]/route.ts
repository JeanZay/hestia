import { after } from "next/server";
import { getApplication, runApplicationMail } from "@/server/runtime";
import { withMailTrigger } from "@/server/identity/worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  const params = await context.params;
  return withMailTrigger(request, () => getApplication().handleReadmissions(request, params.id, params.action), after, runApplicationMail);
}
