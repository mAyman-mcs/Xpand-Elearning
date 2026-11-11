import { useEffect, useState } from "react";
import { useBlocker, type Blocker } from "react-router";
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

/**
 * While `dirty`, closing or reloading the tab gets the browser's own warning, and moving to another
 * page inside the app is held: show `<LeavePageDialog blocker={…} />` to let the user choose.
 */
export function useUnsavedChanges(dirty: boolean): Blocker {
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);
  return useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
}

/** The value, after it has stopped changing for `ms` (search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
