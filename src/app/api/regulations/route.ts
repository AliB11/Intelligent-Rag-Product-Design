import { getRegulations, setRegulations, resetRegulations } from "@/lib/simorgh/regulations";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function PUT(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  if (!isRecord(payload)) return Response.json({ error: "body must be an object" }, { status: 400 });
  const patch: Record<string, number> = {};
  const numericKeys = ["loanRateCap", "qardFeeCap", "absoluteCap", "gamCap", "ldrCeiling", "lcrFloor", "dtiCap", "microLoanCap", "inflation"] as const;
  for (const key of numericKeys) {
    const value = payload[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return Response.json({ error: `${key} must be a non-negative number` }, { status: 400 });
    }
    patch[key] = value;
  }
  return Response.json({ regulations: setRegulations(patch) });
}

export async function DELETE() {
  return Response.json({ regulations: resetRegulations() });
}
