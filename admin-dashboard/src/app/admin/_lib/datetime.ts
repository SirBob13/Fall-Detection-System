export function parseApiDate(value?: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Backend timestamps are UTC, but SQLite/FastAPI can serialize them without
  // a timezone suffix. Make UTC explicit before the browser parses them.
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = hasTimezone ? trimmed : `${trimmed}Z`;
  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatApiDateTime(value?: string | null): string {
  return (
    parseApiDate(value)?.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }) || "-"
  );
}

export function apiDateTimeMs(value?: string | null): number {
  return parseApiDate(value)?.getTime() ?? Number.NaN;
}
