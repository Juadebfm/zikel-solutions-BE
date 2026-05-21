import type { FastifyReply } from 'fastify';
import type { ZodError } from 'zod';

/**
 * Creates a plain Error enriched with `statusCode` and `code` so that
 * Fastify's error handler can serialize it correctly.
 */
export function httpError(statusCode: number, code: string, message: string): Error {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

/**
 * Flattens a Zod issue list into the `{ field: [messages] }` map the FE
 * `applyApiErrorsToForm` helper consumes. Keys mirror the form-field path
 * (`address.line1`, `members.0.email`, etc.) so RHF can map directly.
 */
function buildFieldErrors(error: ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    if (issue.path.length === 0) continue;
    const key = issue.path.map((segment) => String(segment)).join('.');
    if (!fieldErrors[key]) fieldErrors[key] = [];
    fieldErrors[key].push(issue.message);
  }
  return fieldErrors;
}

/**
 * Emits a 422 validation-error envelope including the audit-spec `fieldErrors`
 * map so the FE can wire field-level highlighting. `message` is the first
 * issue's message for backwards-compat with existing toast/banner callers.
 */
export function sendValidationError(reply: FastifyReply, error: ZodError, statusCode = 422) {
  return reply.status(statusCode).send({
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: error.issues[0]?.message ?? 'Validation error.',
      fieldErrors: buildFieldErrors(error),
    },
  });
}

export { buildFieldErrors };
