/**
 * Row → DTO mapping helpers.
 *
 * The database stores real `timestamptz` values (JS `Date`), while every shared
 * schema exposes ISO-8601 UTC strings. Every service that returns rows to a
 * client must run them through these helpers so responses satisfy the Zod
 * response schemas from `@osvald/shared`.
 */

/** `Date` → ISO-8601 UTC string, e.g. `2026-09-21T12:00:00.000Z`. */
export function toIsoDateTime(value: Date): string {
  return value.toISOString();
}

export function toIsoDateTimeOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}
