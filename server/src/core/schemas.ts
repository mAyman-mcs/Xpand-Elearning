import { z } from "zod";

export const uuid = z.uuid();
export const idParams = z.object({ id: uuid });
/** A list of distinct ids (duplicates are removed). */
export const uuidList = z
  .array(uuid)
  .max(500)
  .transform((ids) => [...new Set(ids)]);
export const nonBlank = (max: number) => z.string().trim().min(1).max(max);

/** A "true"/"false" query-string flag. */
export const queryBoolean = (defaultValue: boolean) =>
  z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default(defaultValue);
