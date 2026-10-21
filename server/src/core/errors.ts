import type { ErrorRequestHandler } from "express";
import type { Logger } from "pino";
import { ZodError } from "zod";

/**
 * The single list of API error codes and their HTTP status.
 * Keep docs/FRONTEND_GUIDE.md §2 in sync when adding one.
 */
export const ERROR_STATUS = {
  INVALID_REQUEST: 400,
  VALIDATION_FAILED: 400,
  WRONG_CURRENT_PASSWORD: 400,
  WEAK_PASSWORD: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  PASSWORD_CHANGE_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  // Exam session (modules/attempts): see docs/API.md §6.7.
  EXAM_NOT_OPEN: 409,
  ALREADY_SUBMITTED: 409,
  ATTEMPT_IN_PROGRESS_ELSEWHERE: 409,
  ATTEMPT_SUBMITTED: 409,
  ATTEMPT_CLOSED: 409,
  QUESTION_CLOSED: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  ACCOUNT_LOCKED: 423,
  TOO_MANY_ATTEMPTS: 429,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly options: { message?: string; details?: unknown } = {},
  ) {
    super(options.message ?? code);
    this.status = ERROR_STATUS[code];
  }

  toJSON() {
    return {
      error: this.code,
      ...(this.options.message ? { message: this.options.message } : {}),
      ...(this.options.details !== undefined ? { details: this.options.details } : {}),
    };
  }
}

export const notFound = (message?: string) => new AppError("NOT_FOUND", { message });
export const forbidden = () => new AppError("FORBIDDEN");
export const conflict = (message: string, details?: unknown) => new AppError("CONFLICT", { message, details });

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    if (res.headersSent) return;

    if (err instanceof AppError) {
      res.status(err.status).json(err);
      return;
    }
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      res.status(400).json({ error: "VALIDATION_FAILED", details });
      return;
    }
    // Client errors raised by Express middleware (malformed JSON → 400, body too large → 413).
    const status = (err as { status?: unknown } | null)?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      res.status(status).json({ error: status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_REQUEST" });
      return;
    }

    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: "INTERNAL_ERROR" });
  };
}
