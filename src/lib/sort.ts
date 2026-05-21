import { httpError } from './errors.js';

export type SortDirection = 'asc' | 'desc';
export type SortSpec<T extends string> = { by: T; dir: SortDirection };

/**
 * Parses an optional `sortBy` + `sortDir`/`sortOrder` pair against a server-side
 * allowlist of sortable columns. Throws 400 `INVALID_SORT_FIELD` when the
 * caller supplies a `sortBy` outside the allowlist — so client cannot pass
 * arbitrary column names and the FE sees a predictable error.
 *
 * `sortDir` is the audit-spec canonical name; `sortOrder` is accepted as a
 * backwards-compatible alias for existing list endpoints.
 */
export function parseSort<T extends string>(args: {
  sortBy: string | undefined;
  sortDir?: string | undefined;
  sortOrder?: string | undefined;
  allowed: readonly T[];
  defaultBy: T;
  defaultDir?: SortDirection | undefined;
}): SortSpec<T> {
  const dirRaw = args.sortDir ?? args.sortOrder ?? args.defaultDir ?? 'desc';
  const dir: SortDirection = dirRaw === 'asc' ? 'asc' : 'desc';

  if (args.sortBy === undefined || args.sortBy === '') {
    return { by: args.defaultBy, dir };
  }

  if (!(args.allowed as readonly string[]).includes(args.sortBy)) {
    throw httpError(
      400,
      'INVALID_SORT_FIELD',
      `Unknown sort field "${args.sortBy}". Allowed: ${args.allowed.join(', ')}.`,
    );
  }

  return { by: args.sortBy as T, dir };
}
