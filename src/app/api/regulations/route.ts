import { getRegulations, setRegulations, resetRegulations } from "@/lib/simorgh/regulations";
import { formatZodIssues, regulationsPatchSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/regulations            — the configurable regulatory rulebook
 * PUT  /api/regulations            — patch caps (hard floors of CBI defaults enforced)
 * DELETE /api/regulations          — reset to statutory defaults
 */
export async function GET() {
  return Response.json({ regulations: getRegulations() });
}

export async function PUT(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const parsed = regulationsPatchSchema.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
  }
  return Response.json({ regulations: setRegulations(parsed.data) });
}

export async function DELETE() {
  return Response.json({ regulations: resetRegulations() });
}
