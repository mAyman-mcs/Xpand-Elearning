import { z } from "zod";

/** A calendar date ("2026-07-05"), stored as UTC midnight in @db.Date columns. */
export const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .transform((s) => new Date(`${s}T00:00:00Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "Invalid date");

export function formatDateOnly(d: Date): string;
export function formatDateOnly(d: Date | null): string | null;
export function formatDateOnly(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
