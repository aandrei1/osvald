import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.js';

/**
 * Values mirror `scriptStatusSchema` in `@osvald/shared`.
 * Keep both in sync when adding a state.
 */
export const scriptStatusEnum = pgEnum('script_status', [
  'uploaded',
  'parsing',
  'parsed',
  'failed',
]);

export const scripts = pgTable(
  'scripts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Owner. Nullable so anonymous/sandbox scripts are possible. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    author: text('author'),
    description: text('description'),
    status: scriptStatusEnum('status').notNull().default('uploaded'),
    /** Original file name, for display. */
    sourceFileName: text('source_file_name'),
    /** Path on disk (TODO: move to object storage and store a key instead). */
    sourceFilePath: text('source_file_path'),
    /** Pages in the source document, filled in by the parsing worker. */
    pageCount: integer('page_count'),
    /** Failure reason of the last parse attempt, surfaced in the UI. */
    parseError: text('parse_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('scripts_user_id_idx').on(table.userId)],
);

export type ScriptRow = typeof scripts.$inferSelect;
export type NewScriptRow = typeof scripts.$inferInsert;
