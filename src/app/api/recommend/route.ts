import { recommendProducts } from "@/lib/domain/recommendation";
import type { GuaranteeType } from "@/lib/domain/types";
import { formatZodIssues, recommendRequestSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "درخواست JSON معتبر نیست." }, { status: 400 });
  }

  const parsed = recommendRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
  }

  const data = parsed.data;
  return Response.json(
    recommendProducts({
      query: data.query,
      amountToman: data.amountToman,
      monthlyIncomeToman: data.monthlyIncomeToman,
      existingInstallmentToman: data.existingInstallmentToman,
      availableDepositToman: data.availableDepositToman,
      maxSleepMonths: data.maxSleepMonths,
      alternativeYield: data.alternativeYield,
      availableGuarantees: data.availableGuarantees as GuaranteeType[] | undefined,
    }),
  );
}
