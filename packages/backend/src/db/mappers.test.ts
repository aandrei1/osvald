import { describe, expect, it } from 'vitest';

import { toIsoDateTime, toIsoDateTimeOrNull } from './mappers.js';

/**
 * The database stores `timestamptz` (JS `Date`), while every shared schema
 * exposes an ISO-8601 UTC string. A miss here makes the response fail its own
 * Zod schema, which the client surfaces as a broken screen.
 */

describe('toIsoDateTime', () => {
  it('converts a Date to the wire format', () => {
    expect(toIsoDateTime(new Date('2026-10-18T12:34:56.789Z'))).toBe('2026-10-18T12:34:56.789Z');
  });

  it('normalises a non-UTC instant to UTC', () => {
    expect(toIsoDateTime(new Date('2026-10-18T14:34:56.789+02:00'))).toBe(
      '2026-10-18T12:34:56.789Z',
    );
  });
});

describe('toIsoDateTimeOrNull', () => {
  it('passes null through', () => {
    expect(toIsoDateTimeOrNull(null)).toBeNull();
  });

  it('converts a present value', () => {
    expect(toIsoDateTimeOrNull(new Date('2026-10-18T12:00:00.000Z'))).toBe(
      '2026-10-18T12:00:00.000Z',
    );
  });
});
