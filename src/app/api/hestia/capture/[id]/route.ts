import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: {params: Promise<{id:string}>}) { const params=await context.params; return getApplication().handleCapture(request,params.id); }
export async function PATCH(request: Request, context: {params: Promise<{id:string}>}) { const params=await context.params; return getApplication().handleCapture(request,params.id); }
export async function DELETE(request: Request, context: {params: Promise<{id:string}>}) { const params=await context.params; return getApplication().handleCapture(request,params.id); }
