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
