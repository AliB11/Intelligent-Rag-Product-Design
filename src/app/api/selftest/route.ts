import { runVerificationSuite } from "@/lib/verification/financialEngineTests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * GET /api/selftest?fast=1 — executes the automated verification suite:
 * deterministic financial-engine tests, correction/seed and graph-control
 * regressions, plus two product integration scenarios: the 20-Hemmat matrix
 * and the physician/dental closed-loop ecosystem.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const fast = url.searchParams.get("fast") === "1";
  try {
    const result = await runVerificationSuite(fast);
    return Response.json(result, { status: result.passed ? 200 : 500 });
  } catch (error) {
    return Response.json(
      {
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
