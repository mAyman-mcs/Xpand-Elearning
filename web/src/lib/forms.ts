import { useEffect, useState } from "react";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { errorMessage, fieldErrors } from "./api";

/**
 * Puts the server's VALIDATION_FAILED details next to the matching form fields, and returns the
 * message for everything else (shown above the form). The server always has the final word.
 */
export function applyServerErrors<T extends FieldValues>(
  error: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
  overrides?: Record<string, string>,
): string | null {
  const byField = fieldErrors(error);
  let unmatched = false;
  for (const [path, message] of Object.entries(byField)) {
    const field = fields.find((f) => path === f || path.startsWith(`${f}.`));
    if (field) setError(field, { type: "server", message });
    else unmatched = true;
  }
  if (Object.keys(byField).length && !unmatched) return null;
  return errorMessage(error, overrides);
}

/** Empty form strings become null for optional API fields. */
export const blankToNull = (value: string | null | undefined): string | null => {
  const v = value?.trim();
  return v ? v : null;
};

/** The value, after it has stopped changing for `ms` (search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
