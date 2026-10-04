import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return getApplication().handleReadmissions(request);
}
export const GET = POST;
