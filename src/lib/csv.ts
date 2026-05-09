/**
 * Minimal RFC-4180 CSV serializer. We don't pull a dependency for this — the
 * data we export from this codebase is well-shaped (no embedded line breaks
 * in column names, controlled column types) and the rules are short.
 *
 * Escaping rules:
 *   - Wrap any field containing `"`, `,`, `\n`, or `\r` in double quotes.
 *   - Escape internal `"` as `""`.
 *   - `null` / `undefined` → empty string.
 *   - Date → ISO-8601 string.
 *   - Object/array → JSON.stringify, then quote-escape.
 */

export type CsvScalar = string | number | boolean | null | undefined | Date;
export type CsvCell = CsvScalar | Record<string, unknown> | unknown[];

function formatCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function escapeCell(raw: string): string {
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n') || raw.includes('\r')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/**
 * Serializes `rows` to CSV using `columns` (keyed lookup) for the column order
 * and header labels. Emits a UTF-8 BOM by default so Excel opens it cleanly.
 *
 * Cell values are coerced via `formatCell` — null/undefined → empty, Date →
 * ISO, object/array → JSON. Non-CsvCell types are widened internally rather
 * than constraining T, so concrete row interfaces (not index signatures) work
 * directly without `as` casts at the call site.
 */
export function rowsToCsv<T>(
  rows: T[],
  columns: Array<{ key: keyof T; header: string }>,
  opts: { bom?: boolean } = {},
): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeCell(c.header)).join(','));
  for (const row of rows) {
    lines.push(
      columns
        .map((c) => escapeCell(formatCell(row[c.key] as CsvCell)))
        .join(','),
    );
  }
  const body = lines.join('\n') + '\n';
  return opts.bom === false ? body : '﻿' + body;
}
