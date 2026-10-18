import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request:Request,context:{params:Promise<{id:string}>}){return getApplication().handleOutgoingOperation(request,(await context.params).id);}
