import { SCRIPT_STAGES } from '@osvald/shared';
import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.js';
import { workspaces } from './workspaces.js';

/** Values come from `SCRIPT_STAGES` in `@osvald/shared`. */
export const scriptStageEnum = pgEnum('script_stage', SCRIPT_STAGES);

export const scripts = pgTable(
  'scripts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Its members read and rehearse it; its editor prepares it. */
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'restrict' }),
    /** Who uploaded it. `null` once that account is gone. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    author: text('author'),
    description: text('description'),
    /** Changed only through `ScriptProductionFlow`, with a conditional update. */
    stage: scriptStageEnum('stage').notNull().default('extracting'),
    stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Current run of the work stage. Every import, reparse or synthesis gets a
     * new one, and job reactions carrying another run id are ignored.
     */
    runId: uuid('run_id').notNull().defaultRandom(),
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
  (table) => [
    // A workspace's library, newest first.
    index('scripts_workspace_id_created_at_idx').on(table.workspaceId, table.createdAt),
    // The recovery job looks for scripts that sat in a work stage for too long.
    index('scripts_stage_stage_entered_at_idx').on(table.stage, table.stageEnteredAt),
  ],
);

export type ScriptRow = typeof scripts.$inferSelect;
export type NewScriptRow = typeof scripts.$inferInsert;
