import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  const params = await context.params;
  return getApplication().handleMeRecoveryCodes(request, params.action);
}
