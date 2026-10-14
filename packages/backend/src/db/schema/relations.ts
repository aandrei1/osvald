import { relations } from 'drizzle-orm';

import { characters } from './characters.js';
import { lines } from './lines.js';
import { scenes } from './scenes.js';
import { scripts } from './scripts.js';
import { users } from './users.js';

/**
 * Relations live in their own module so the table files can reference each
 * other (foreign keys) without circular imports. They power the relational
 * query API: `db.query.scripts.findMany({ with: { scenes: { with: { lines: true } } } })`.
 */

export const usersRelations = relations(users, ({ many }) => ({
  scripts: many(scripts),
}));

export const scriptsRelations = relations(scripts, ({ one, many }) => ({
  user: one(users, { fields: [scripts.userId], references: [users.id] }),
  scenes: many(scenes),
  characters: many(characters),
}));

export const scenesRelations = relations(scenes, ({ one, many }) => ({
  script: one(scripts, { fields: [scenes.scriptId], references: [scripts.id] }),
  lines: many(lines),
}));

export const charactersRelations = relations(characters, ({ one, many }) => ({
  script: one(scripts, { fields: [characters.scriptId], references: [scripts.id] }),
  lines: many(lines),
}));

export const linesRelations = relations(lines, ({ one }) => ({
  scene: one(scenes, { fields: [lines.sceneId], references: [scenes.id] }),
  character: one(characters, {
    fields: [lines.characterId],
    references: [characters.id],
  }),
}));
