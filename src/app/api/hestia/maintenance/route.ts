import { getApplication } from "@/server/runtime";
import { handleMaintenance } from "@/server/documents/maintenance";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  return handleMaintenance(request,process.env.CRON_SECRET,getApplication);
}
