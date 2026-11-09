/**
 * Temporal & regulatory governance for knowledge chunks.
 * ---------------------------------------------------------------------------
 * Every KB chunk carries `RegulatoryChunkMeta` (effective / expiration ISO
 * timestamps, ACTIVE|SUPERSEDED|AMENDED status, Sharia contract type and
 * structured regulatory caps). The metadata is Zod-validated at index-build
 * time and enforced as a PRE-FILTER before any BM25 / dense scoring so that
 * superseded, amended, expired or not-yet-effective rules can never surface
 * — let alone influence the executable constraint envelope.
 */

import { z } from "zod";
import type { RegulatoryChunkMeta } from "../domain/types";

const isoTimestamp = z
  .string("ISO timestamp required")
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "must be an ISO-8601 timestamp",
  });

const regulatoryCapsSchema = z
  .object({
    maxLoanInterestRate: z.number().min(0).max(1).optional(),
    maxFeeRate: z.number().min(0).max(1).optional(),
    minReserveRatio: z.number().min(0).max(1).optional(),
    effectiveRateCap: z.number().min(0).max(1).optional(),
    allowBlockedDepositCollateral: z.boolean().optional(),
  })
  .strict();

/** Strict schema for chunk governance metadata. */
export const regulatoryChunkMetaSchema = z
  .object({
    effective_date: isoTimestamp,
    expiration_date: isoTimestamp.nullish(),
    status: z.enum(["ACTIVE", "SUPERSEDED", "AMENDED"]),
    sharia_contract_type: z.enum([
      "QARD_AL_HASAN",
      "MURABAHA",
      "MUDARABAH",
      "JOALAH",
      "SPECIAL_DEPOSIT",
      "GENERAL",
    ]),
    regulatory_caps: regulatoryCapsSchema.optional(),
  })
  .strict()
  .superRefine((meta, ctx) => {
    const start = Date.parse(meta.effective_date);
    const end = meta.expiration_date ? Date.parse(meta.expiration_date) : null;
    if (end !== null && end <= start) {
      ctx.addIssue({
        code: "custom",
        message: "expiration_date must be after effective_date",
        path: ["expiration_date"],
      });
    }
  });

export type RegulatoryChunkMetaParsed = z.output<typeof regulatoryChunkMetaSchema>;

/**
 * Is the chunk in force at instant `at`?
 * Inclusive start (effective_date ≤ at), exclusive end (at < expiration_date),
 * and status must be exactly ACTIVE.
 */
export function isChunkActiveAt(meta: RegulatoryChunkMeta, at: Date): boolean {
  if (meta.status !== "ACTIVE") return false;
  const now = at.getTime();
  if (!Number.isFinite(now)) return false;
  const start = Date.parse(meta.effective_date);
  if (!Number.isFinite(start) || now < start) return false;
  if (meta.expiration_date) {
    const end = Date.parse(meta.expiration_date);
    if (!Number.isFinite(end) || now >= end) return false;
  }
  return true;
}

/** Convenience predicate for a document-shaped object carrying `governance`. */
export function activeDocFilter<T extends { governance?: RegulatoryChunkMeta }>(
  at: Date,
): (doc: T) => boolean {
  return (doc) => Boolean(doc.governance) && isChunkActiveAt(doc.governance!, at);
}
