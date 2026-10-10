import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: {params: Promise<{id:string;pageId:string}>}) { const params=await context.params; return getApplication().handleCapturePageComplete(request,params.id,params.pageId); }
