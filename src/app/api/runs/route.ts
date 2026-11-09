import { getRun, listRuns } from "@/lib/db/repository";
import { formatZodIssues, runsQuerySchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/runs -> saved generation runs. GET /api/runs?id=... -> full audit trail. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = runsQuerySchema.safeParse({
    ...(url.searchParams.get("id") !== null ? { id: url.searchParams.get("id") ?? undefined } : {}),
    ...(url.searchParams.get("limit") !== null ? { limit: url.searchParams.get("limit") } : {}),
  });
  if (!parsed.success) {
    return Response.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
  }
  const { id, limit } = parsed.data;
  if (id) {
    const run = await getRun(id);
    if (!run) return Response.json({ error: "not found" }, { status: 404 });
    return Response.json({ run });
  }
  const runs = await listRuns(limit ?? 25);
  return Response.json({ runs, count: runs.length });
}
