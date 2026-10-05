import { after } from "next/server";
import { getApplication, runApplicationMail } from "@/server/runtime";
import { withMailTrigger } from "@/server/identity/worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  return withMailTrigger(request, () => getApplication().handleInvitations(request), after, runApplicationMail);
}
export const POST = GET;
