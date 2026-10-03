import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PUT(request: Request, context: { params: Promise<{id:string;index:string}> }) { const p = await context.params; return getApplication().handleUploadChunk(request,p.id,p.index); }
