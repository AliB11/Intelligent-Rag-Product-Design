import { recommendProducts } from "@/lib/domain/recommendation";
import type { GuaranteeType } from "@/lib/domain/types";

export const runtime = "nodejs";
const guarantees: GuaranteeType[] = ["none", "sana-safteh", "sayad-cheque", "payroll-deduction", "official-guarantor", "deposit-block", "wealth-collateral", "property-deed", "vehicle-pledge", "pos-turnover"];

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "درخواست JSON معتبر نیست." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "درخواست معتبر نیست." }, { status: 400 });
  const data = body as Record<string, unknown>;
  if (typeof data.query !== "string" || !data.query.trim() || data.query.length > 2000) return Response.json({ error: "شرح نیاز باید بین ۱ تا ۲۰۰۰ نویسه باشد." }, { status: 400 });
  for (const key of ["amountToman", "monthlyIncomeToman", "existingInstallmentToman", "availableDepositToman", "maxSleepMonths", "alternativeYield"]) {
    const value = data[key];
    const max = key === "alternativeYield" ? 1 : key === "maxSleepMonths" ? 600 : 1e15;
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max)) return Response.json({ error: `مقدار ${key} معتبر نیست.` }, { status: 400 });
  }
  if (data.availableGuarantees !== undefined && (!Array.isArray(data.availableGuarantees) || data.availableGuarantees.length > guarantees.length || data.availableGuarantees.some((v) => typeof v !== "string" || !guarantees.includes(v as GuaranteeType)))) return Response.json({ error: "نوع ضمانت معتبر نیست." }, { status: 400 });
  return Response.json(recommendProducts({ query: data.query, amountToman: data.amountToman as number | undefined, monthlyIncomeToman: data.monthlyIncomeToman as number | undefined, existingInstallmentToman: data.existingInstallmentToman as number | undefined, availableDepositToman: data.availableDepositToman as number | undefined, maxSleepMonths: data.maxSleepMonths as number | undefined, alternativeYield: data.alternativeYield as number | undefined, availableGuarantees: data.availableGuarantees as GuaranteeType[] | undefined }));
}
