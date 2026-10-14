import { hash, verify } from '@node-rs/argon2';
import { eq, sql } from 'drizzle-orm';
import type { User } from '@osvald/shared';

import type { Database } from '../db/client.js';
import { toIsoDateTime } from '../db/mappers.js';
import { users, type NewUserRow, type UserRow } from '../db/schema/users.js';
import { ConflictError, UnauthorizedError } from '../lib/errors.js';

/**
 * Accounts and credentials.
 *
 * Passwords are stored as Argon2id hashes. The parameters below are the OWASP
 * baseline (19 MiB, 2 iterations, 1 lane); the cost lives in the hash string,
 * so raising it later does not invalidate existing hashes.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * A throwaway hash to verify against when no account matched. It keeps the work
 * done on an unknown e-mail comparable to a real check, so response timing does
 * not reveal which addresses are registered. Built on first use, then reused.
 */
let dummyHashPromise: Promise<string> | undefined;

function dummyHash(): Promise<string> {
  dummyHashPromise ??= hash('osvald-timing-equalizer', ARGON2_OPTIONS);
  return dummyHashPromise;
}

/** Row → API DTO. Never leaks `passwordHash`. */
export function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    createdAt: toIsoDateTime(row.createdAt),
    updatedAt: toIsoDateTime(row.updatedAt),
  };
}

/** E-mail addresses are compared case-insensitively, so they are stored folded. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(db: Database, email: string): Promise<UserRow | null> {
  const row = await db.query.users.findFirst({
    where: eq(users.email, normalizeEmail(email)),
  });
  return row ?? null;
}

export async function findUserById(db: Database, id: string): Promise<UserRow | null> {
  const row = await db.query.users.findFirst({ where: eq(users.id, id) });
  return row ?? null;
}

export interface RegisterUserInput {
  email: string;
  password: string;
  displayName?: string | null;
}

/**
 * Creates an account.
 *
 * The unique index on `email` is the authority on duplicates rather than a
 * preceding SELECT: two concurrent registrations would both pass the check and
 * only the insert can actually arbitrate.
 */
export async function registerUser(db: Database, input: RegisterUserInput): Promise<UserRow> {
  const values: NewUserRow = {
    email: normalizeEmail(input.email),
    passwordHash: await hash(input.password, ARGON2_OPTIONS),
    displayName: input.displayName ?? null,
  };

  try {
    const [row] = await db.insert(users).values(values).returning();

    if (row === undefined) {
      throw new Error('Insert into "users" returned no row');
    }

    return row;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('An account with that e-mail address already exists');
    }
    throw error;
  }
}

/**
 * Checks credentials, returning the user on success.
 *
 * Both failure modes — unknown address and wrong password — raise the same
 * error, and both do the same amount of hashing work.
 */
export async function verifyCredentials(
  db: Database,
  email: string,
  password: string,
): Promise<UserRow> {
  const row = await findUserByEmail(db, email);
  const hashToCheck = row?.passwordHash ?? (await dummyHash());
  const matches = await verify(hashToCheck, password).catch(() => false);

  if (row === null || !matches) {
    throw new UnauthorizedError('Incorrect e-mail address or password');
  }

  return row;
}

/** Postgres `unique_violation` (SQLSTATE 23505). */
const UNIQUE_VIOLATION = '23505';

/**
 * Recognises a unique-constraint failure.
 *
 * Drizzle wraps driver errors in a `DrizzleQueryError`, so the SQLSTATE sits on
 * a `cause` further down rather than on the error that was thrown. The chain is
 * walked instead of inspecting only the top-level object — and it must be
 * walked, because the wrapper's message embeds the query parameters, which for
 * this query include the password hash.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (typeof current !== 'object') {
      return false;
    }

    if ('code' in current && current.code === UNIQUE_VIOLATION) {
      return true;
    }

    current = 'cause' in current ? current.cause : null;
  }

  return false;
}

/**
 * Finds a user by e-mail or creates them. Used by the seed importer so it can
 * run repeatedly without failing on the second pass.
 */
export async function upsertUser(db: Database, input: RegisterUserInput): Promise<UserRow> {
  const existing = await findUserByEmail(db, input.email);

  if (existing !== null) {
    return existing;
  }

  return registerUser(db, input);
}

/** Count of registered accounts, used by the seed to report what it did. */
export async function countUsers(db: Database): Promise<number> {
  const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(users);
  return row?.total ?? 0;
}

/*
 * TODO(auth): refresh-token rotation + revocation (a new `refresh_tokens`
 * table), e-mail verification, and password reset. `POST /auth/login` should
 * also get @fastify/rate-limit before this is exposed publicly.
 */
