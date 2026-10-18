import { describe, expect, it } from 'vitest';

import { normalizeEmail } from './user.service.js';

/**
 * Addresses are stored folded so the unique index is the only authority on
 * duplicates: `Actor@Example.COM` and `actor@example.com` must be one account.
 */

describe('normalizeEmail', () => {
  it('trims and lowercases an address', () => {
    expect(normalizeEmail('  Actor@Example.COM ')).toBe('actor@example.com');
  });

  it('is idempotent', () => {
    const once = normalizeEmail('ACTOR@EXAMPLE.COM');
    expect(normalizeEmail(once)).toBe(once);
  });

  it('leaves an empty string empty', () => {
    expect(normalizeEmail('   ')).toBe('');
  });
});
