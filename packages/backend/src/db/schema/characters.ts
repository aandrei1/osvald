import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { scripts } from './scripts.js';

export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scriptId: uuid('script_id')
      .notNull()
      .references(() => scripts.id, { onDelete: 'cascade' }),
    /** Canonical display name, e.g. `Hamlet`. */
    name: text('name').notNull(),
    /** Casting/appearance notes. */
    description: text('description'),
    /** Alternate spellings found in the source document, e.g. `HAMLET`, `Ham.`. */
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('characters_script_id_name_unique').on(table.scriptId, table.name)],
);

export type CharacterRow = typeof characters.$inferSelect;
export type NewCharacterRow = typeof characters.$inferInsert;
