export function GET() {
  return Response.json(
    { status: "ok", application: "hestia" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
