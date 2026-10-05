import { after } from "next/server";
import { getApplication, runApplicationMail } from "@/server/runtime";
import { withMailTrigger } from "@/server/identity/worker";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  return withMailTrigger(request, () => getApplication().handleReadmissions(request), after, runApplicationMail);
}
export const GET = POST;
