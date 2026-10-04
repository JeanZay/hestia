import { getApplication } from "@/server/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function DELETE(request: Request, context: { params: Promise<{ id: string; grantId:string }> }) {
  const {id,grantId}=await context.params;
  return getApplication().handleRevokeAccess(request,id,grantId);
}
