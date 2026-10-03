import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(request: Request, context: { params: Promise<{id:string}> }) { return getApplication().handleUpload(request, (await context.params).id); }
