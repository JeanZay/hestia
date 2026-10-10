import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function PUT(request: Request, context: {params: Promise<{id:string;pageId:string;index:string}>}) { const params=await context.params; return getApplication().handleCapturePageChunk(request,params.id,params.pageId,params.index); }
