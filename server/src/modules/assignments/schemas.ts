import { z } from "zod";
import { nonBlank, uuid, uuidList } from "../../core/schemas.js";
import type { ScheduleFields } from "./availability.js";

const instant = z.iso.datetime({ offset: true }).pipe(z.coerce.date());

/** Exactly one of a student or a group. */
export const targetSchema = z
  .object({ userId: uuid.optional(), groupId: uuid.optional() })
  .refine((t) => (t.userId === undefined) !== (t.groupId === undefined), "Give exactly one of userId or groupId.");
export type Target = z.infer<typeof targetSchema>;

export const scheduleSchema = z.discriminatedUnion("mode", [
  z
    .object({ mode: z.literal("FIXED"), opensAt: instant, closesAt: instant.nullable().default(null) })
    .refine((s) => !s.closesAt || s.closesAt > s.opensAt, {
      message: "closesAt must be after opensAt.",
      path: ["closesAt"],
    }),
  z.object({
    mode: z.literal("RELATIVE"),
    offsetDays: z.number().int().min(0).max(366),
    openTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm (Cairo time)"),
    windowMinutes: z
      .number()
      .int()
      .min(1)
      .max(60 * 24 * 14),
  }),
  z.object({ mode: z.literal("MANUAL") }),
]);
export type Schedule = z.infer<typeof scheduleSchema>;

/** Database columns for a schedule; fields that do not belong to the mode are cleared. */
export function scheduleColumns(s: Schedule): ScheduleFields {
  return {
    mode: s.mode,
    opensAt: s.mode === "FIXED" ? s.opensAt : null,
    closesAt: s.mode === "FIXED" ? s.closesAt : null,
    offsetDays: s.mode === "RELATIVE" ? s.offsetDays : null,
    openTime: s.mode === "RELATIVE" ? s.openTime : null,
    windowMinutes: s.mode === "RELATIVE" ? s.windowMinutes : null,
  };
}

export const createAssignmentBody = z.object({ examId: uuid, target: targetSchema, schedule: scheduleSchema });
export const updateAssignmentBody = z.object({ schedule: scheduleSchema });

/** Several exams × several targets, one schedule (decision D8: creates rows once, not a live rule). */
export const bulkAssignmentBody = z
  .object({
    examIds: uuidList.optional(),
    categoryId: uuid.optional(),
    tagIds: uuidList.optional(),
    targets: z.array(targetSchema).min(1).max(200),
    schedule: scheduleSchema,
  })
  .refine(
    (b) => [b.examIds, b.categoryId, b.tagIds].filter((x) => x !== undefined).length === 1,
    "Select exams by exactly one of examIds, categoryId or tagIds.",
  );
export type BulkAssignment = z.infer<typeof bulkAssignmentBody>;

export const examQuery = z.object({ examId: uuid });

export const createOverrideBody = z
  .object({
    examId: uuid,
    target: targetSchema,
    action: z.enum(["OPEN", "CLOSE"]),
    validFrom: instant.optional(),
    validUntil: instant.nullable().default(null),
    reason: nonBlank(500),
  })
  .refine((o) => !o.validUntil || !o.validFrom || o.validUntil > o.validFrom, {
    message: "validUntil must be after validFrom.",
    path: ["validUntil"],
  });
