import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { characters } from './characters.js';
import { scenes } from './scenes.js';

/**
 * Values mirror `lineTypeSchema` in `@osvald/shared`.
 * `dialogue` = spoken text, `direction` = stage direction.
 */
export const lineTypeEnum = pgEnum('line_type', ['dialogue', 'direction']);

export const lines = pgTable(
  'lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sceneId: uuid('scene_id')
      .notNull()
      .references(() => scenes.id, { onDelete: 'cascade' }),
    /** Null for stage directions and for speakers that were not resolved yet. */
    characterId: uuid('character_id').references(() => characters.id, {
      onDelete: 'set null',
    }),
    /** 0-based position of the line inside its scene. */
    orderIndex: integer('order_index').notNull(),
    type: lineTypeEnum('type').notNull(),
    /** Name exactly as printed in the source document, e.g. `1st GRAVEDIGGER`. */
    speakerLabel: text('speaker_label'),
    text: text('text').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('lines_scene_id_order_index_idx').on(table.sceneId, table.orderIndex)],
);

export type LineRow = typeof lines.$inferSelect;
export type NewLineRow = typeof lines.$inferInsert;
