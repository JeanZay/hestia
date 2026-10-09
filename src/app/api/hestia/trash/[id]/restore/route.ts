import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return getApplication().handleFolderRestore(request, (await context.params).id);
}
