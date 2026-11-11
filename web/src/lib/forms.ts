import { useCallback, useEffect, useState } from "react";
import { useBlocker, useSearchParams, type Blocker } from "react-router";
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

/**
 * List filters kept in the URL (?role=STUDENT&q=ali), so Back from a detail page, a reload or a
 * shared link keeps them. Values equal to their default are left out of the URL. Changes replace
 * the history entry: typing in a filter doesn't add a Back step per letter.
 */
export function useUrlFilters<T extends Record<string, string>>(defaults: T) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [key, params.get(key) ?? fallback]),
  ) as T;
  const set = useCallback(
    (patch: Partial<T>) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === defaults[key]) next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      ),
    // `defaults` is a literal at each call site: compare by content, not identity.
    [setParams, JSON.stringify(defaults)],
  );
  const active = Object.entries(defaults).some(([key, fallback]) => values[key] !== fallback);
  const clear = useCallback(() => set(defaults), [set, defaults]);
  return { values, set, clear, active };
}

/**
 * A search box over a URL filter: the box updates at once, the filter after typing pauses.
 * `reset` empties both (for "Clear filters").
 */
export function useSearchBox(value: string, commit: (q: string) => void) {
  const [text, setText] = useState(value);
  const debounced = useDebounced(text.trim());
  useEffect(() => {
    if (debounced !== value) commit(debounced);
    // Only when the typed text settles; `value` follows from it.
  }, [debounced]);
  return { text, setText, reset: () => setText("") };
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
