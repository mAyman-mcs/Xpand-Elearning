import { ApiError } from "./client";

// One readable message per API error code (docs/API.md §1). Screens may pass more specific ones.
const MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: "Some fields are not valid. Check the highlighted fields.",
  INVALID_REQUEST: "The request was malformed.",
  WRONG_CURRENT_PASSWORD: "Your current password is incorrect.",
  WEAK_PASSWORD: "The new password is too weak.",
  UNAUTHENTICATED: "Your session expired. Please sign in again.",
  INVALID_CREDENTIALS: "Invalid username or password.",
  PASSWORD_CHANGE_REQUIRED: "You must change your password first.",
  FORBIDDEN: "You don't have permission to do this.",
  NOT_FOUND: "Not found, or you don't have access to it.",
  CONFLICT: "This conflicts with existing data.",
  PAYLOAD_TOO_LARGE: "That is too much data for one request.",
  UNSUPPORTED_MEDIA_TYPE: "The request was malformed.",
  ACCOUNT_LOCKED: "Too many failed attempts. The account is locked for 15 minutes.",
  TOO_MANY_ATTEMPTS: "Too many attempts from this network. Try again later.",
  INTERNAL_ERROR: "Something went wrong on the server. Try again; if it keeps happening, report it.",
};

/** The message to show for any error: the server's own message when it gives one. */
export function errorMessage(error: unknown, overrides: Record<string, string> = {}): string {
  if (error instanceof ApiError) {
    const override = overrides[error.code];
    if (override) return override;
    // The server sends a readable `message` for most business errors; ApiError falls back to the code.
    if (error.message !== error.code) return error.message;
    return MESSAGES[error.code] ?? "Request failed.";
  }
  if (error instanceof TypeError) return "Network error: check your connection.";
  return "Something went wrong.";
}

/** VALIDATION_FAILED details as { "field.path": "message" }, to show next to form fields. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.code !== "VALIDATION_FAILED" || !Array.isArray(error.details)) return {};
  const out: Record<string, string> = {};
  for (const d of error.details as { path?: unknown; message?: unknown }[]) {
    if (typeof d.path === "string" && typeof d.message === "string" && !(d.path in out)) out[d.path] = d.message;
  }
  return out;
}
