import { ValidationError } from '../shared/errors';

/**
 * Timestamp codecs for raw `pgClient` queries.
 *
 * `db/index.ts` hands the same postgres.js client to `drizzle()`, and the
 * drizzle postgres-js driver mutates that client: it replaces the timestamp
 * (and date/time) serializers *and* parsers with identity functions so that
 * Drizzle can do its own conversions. Consequences for every `pgClient.unsafe`
 * or tagged-template query in the app:
 *
 * - binding a JS `Date` parameter throws inside postgres.js
 *   (`The "string" argument must be of type string … Received an instance of Date`);
 * - a `timestamptz` column comes back as text (`2026-01-11 12:00:00+00`),
 *   not as a `Date`;
 * - binding an object to a `$n::jsonb` parameter throws the same way, because
 *   the `json`/`jsonb` serializers are replaced too.
 *
 * Tests that open their own `postgres()` client do not see any of this, so
 * always go through these helpers at the repository boundary. For jsonb, bind
 * `bindJson(value)` and cast the placeholder `$n::text::jsonb` — that is the
 * only form that round-trips on both a pristine and a drizzle-wrapped client
 * (a bare `$n::jsonb` turns the text into a JSON *string* on a pristine one).
 */
export type PgTimestamp = Date | string;

/** Parse a timestamp column that may be a `Date` or postgres text. */
export function timestampFromRow(value: unknown, name: string): Date {
  const parsed =
    value instanceof Date
      ? new Date(value.getTime())
      : typeof value === 'string'
        ? new Date(value)
        : null;
  if (parsed === null || !Number.isFinite(parsed.getTime())) {
    throw new ValidationError(`${name} must be a valid timestamp`);
  }
  return parsed;
}

export function nullableTimestampFromRow(
  value: unknown,
  name: string,
): Date | null {
  return value === null || value === undefined
    ? null
    : timestampFromRow(value, name);
}

/**
 * Serialise a timestamp for a `$n::timestamptz` parameter. Accepts a `Date`
 * or timestamp text (an ISO instant, or a value read back through pgClient)
 * and always emits canonical ISO-8601 UTC.
 */
export function bindTimestamp(value: PgTimestamp): string;
export function bindTimestamp(value: PgTimestamp | null): string | null;
export function bindTimestamp(value: PgTimestamp | null): string | null {
  if (value === null) return null;
  return timestampFromRow(value, 'Timestamp parameter').toISOString();
}

/** Serialise a JSON value for a `$n::text::jsonb` parameter. */
export function bindJson(value: unknown): string {
  const text = JSON.stringify(value);
  if (typeof text !== 'string') {
    throw new ValidationError('JSON parameter must be serialisable');
  }
  return text;
}
