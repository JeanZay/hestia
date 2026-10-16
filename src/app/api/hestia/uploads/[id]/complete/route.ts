import { scheduleInboxWork } from '@/server/summary/background';
import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{id:string}> }) { const began=performance.now(); const result=await getApplication().handleUploadComplete(request,(await context.params).id); if(result.ok)scheduleInboxWork(began); return result; }
