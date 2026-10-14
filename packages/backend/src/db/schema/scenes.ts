import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { scripts } from './scripts.js';

export const scenes = pgTable(
  'scenes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scriptId: uuid('script_id')
      .notNull()
      .references(() => scripts.id, { onDelete: 'cascade' }),
    /** 0-based position of the scene inside the script. */
    orderIndex: integer('order_index').notNull(),
    /** Scene marker as printed, e.g. `1`, `2a`, `ACT I, SCENE 2`. */
    number: text('number').notNull(),
    title: text('title').notNull(),
    synopsis: text('synopsis'),
    pageStart: integer('page_start'),
    pageEnd: integer('page_end'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('scenes_script_id_order_index_unique').on(table.scriptId, table.orderIndex),
  ],
);

export type SceneRow = typeof scenes.$inferSelect;
export type NewSceneRow = typeof scenes.$inferInsert;
