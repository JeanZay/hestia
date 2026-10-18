import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){return getApplication().handleOutgoingDraft(request,(await context.params).id);}
export const DELETE=PATCH;
