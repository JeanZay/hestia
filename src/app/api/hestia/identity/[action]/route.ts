import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ action: string }> }) {
  const params = await context.params;
  return getApplication().handleIdentity(request, params.action);
}
export const POST = GET;
