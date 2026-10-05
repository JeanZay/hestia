import { after } from "next/server";
import { getApplication, runApplicationMail } from "@/server/runtime";
import { withMailTrigger } from "@/server/identity/worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request, context: { params: Promise<{ action: string }> }) {
  const params = await context.params;
  return withMailTrigger(request, () => getApplication().handleIdentity(request, params.action), after, runApplicationMail);
}
export const POST = GET;
