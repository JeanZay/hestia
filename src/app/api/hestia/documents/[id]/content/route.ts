import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{id:string}> }) { return getApplication().handleDocumentContent(request,(await context.params).id); }
