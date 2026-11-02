import { getRun, listRuns } from "@/lib/db/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/runs -> saved generation runs. GET /api/runs?id=... -> full audit trail. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (id) {
    const run = await getRun(id);
    if (!run) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ run });
  }
  const limit = Number(url.searchParams.get("limit") ?? 25);
  const runs = await listRuns(Number.isFinite(limit) ? Math.min(100, limit) : 25);
  return Response.json({ runs, count: runs.length });
}
