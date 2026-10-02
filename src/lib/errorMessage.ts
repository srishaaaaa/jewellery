/**
 * Extracts a human-readable message from a caught `unknown` error.
 *
 * Supabase/PostgREST errors (from `{ data, error }` responses, or thrown
 * directly as `throw error`) are plain objects with a `message` field —
 * they are never `instanceof Error`. Code that only checked `instanceof
 * Error` before falling back to a generic string was silently discarding
 * the actual database error (e.g. "column not found", "duplicate key",
 * a check constraint violation) on every such failure, which made real
 * problems look like an opaque "An error occurred while saving".
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  if (typeof err === 'string' && err.trim()) return err
  return fallback
}
