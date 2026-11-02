import type { Character, Line, SceneWithLines, ScriptDetail } from '@osvald/shared';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SpeechModule from '@/services/speech';

/**
 * The rehearsal scope: whether a run covers the whole script or one scene.
 *
 * Both are real working modes, and the difference is not cosmetic — a
 * whole-script run has to roll from scene to scene by itself, while a single
 * scene must stop at its end so the actor can take it again.
 */

const speech: SpeechModule.SpeechService = {
  platform: 'web',
  isSupported: () => true,
  listVoices: async () => [],
  speak: async () => 'completed',
  cancel: () => undefined,
};

vi.mock('@/services/speech', async (importOriginal) => ({
  // The voice helpers are real; only the engine itself is replaced.
  ...(await importOriginal<typeof SpeechModule>()),
  getSpeechService: () => speech,
}));

vi.mock('@/services/api', () => ({
  api: {},
  toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : 'Unexpected error'),
}));

import { useRehearsalStore } from './rehearsalStore';
import { useScriptStore } from './scriptStore';

const ISO = '2026-10-18T12:00:00.000Z';

function character(id: string): Character {
  return {
    id,
    scriptId: 'script-1',
    name: id.toUpperCase(),
    description: null,
    aliases: [],
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function line(sceneId: string, characterId: string | null, text: string): Line {
  return {
    id: `${sceneId}-${characterId ?? 'direction'}-${text}`,
    sceneId,
    characterId,
    orderIndex: 0,
    type: characterId === null ? 'direction' : 'dialogue',
    speakerLabel: null,
    text,
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function scene(id: string, orderIndex: number, lines: Line[]): SceneWithLines {
  return {
    id,
    scriptId: 'script-1',
    orderIndex,
    number: String(orderIndex + 1),
    title: `Scena ${orderIndex + 1}`,
    synopsis: null,
    pageStart: null,
    pageEnd: null,
    createdAt: ISO,
    updatedAt: ISO,
    lines,
  };
}

/** Two scenes; `cleante` appears only in the second. */
const SCRIPT: ScriptDetail = {
  id: 'script-1',
  userId: 'user-1',
  title: 'Avarul',
  author: 'Molière',
  description: null,
  status: 'parsed',
  sourceFileName: 'avarul.pdf',
  pageCount: 10,
  parseError: null,
  createdAt: ISO,
  updatedAt: ISO,
  characters: [character('harpagon'), character('cleante')],
  scenes: [
    scene('scene-1', 0, [line('scene-1', 'harpagon', 'Afară de aici!')]),
    scene('scene-2', 1, [
      line('scene-2', 'cleante', 'Tată, te rog.'),
      line('scene-2', 'harpagon', 'Nu.'),
    ]),
  ],
};

function openScript(): ReturnType<typeof useRehearsalStore> {
  useScriptStore().currentScript = SCRIPT;
  return useRehearsalStore();
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('setScope', () => {
  it('runs the whole script by default', () => {
    const store = openScript();

    expect(store.isSceneScoped).toBe(false);
    expect(store.scenes).toHaveLength(2);
    expect(store.hasNextScene).toBe(true);
  });

  it('narrows the rehearsal to one scene', () => {
    const store = openScript();
    store.setScope('scene-2');

    expect(store.isSceneScoped).toBe(true);
    expect(store.scenes.map((item) => item.id)).toEqual(['scene-2']);
    expect(store.currentScene?.id).toBe('scene-2');
    expect(store.lines).toHaveLength(2);
    // Nowhere to run on to: the scene ends where it ends, so it can be retaken.
    expect(store.hasNextScene).toBe(false);
    expect(store.autoAdvanceScene).toBe(false);
  });

  it('keeps the whole script reachable while scoped', () => {
    const store = openScript();
    store.setScope('scene-2');
    store.setScope(null);

    expect(store.isSceneScoped).toBe(false);
    expect(store.scenes).toHaveLength(2);
    expect(store.currentScene?.id).toBe('scene-1');
    // A whole-script run that stopped after every scene would be unusable.
    expect(store.autoAdvanceScene).toBe(true);
  });

  it('falls back to the whole script when the scene no longer exists', () => {
    const store = openScript();
    store.setScope('deleted-scene');

    expect(store.isSceneScoped).toBe(false);
    expect(store.scenes).toHaveLength(2);
  });

  it('rewinds to the start of the newly scoped scene', () => {
    const store = openScript();
    store.selectScene(1);
    store.goToLine(1);
    store.setScope('scene-1');

    expect(store.sceneIndex).toBe(0);
    expect(store.lineIndex).toBe(0);
    expect(store.isRevealed).toBe(false);
  });

  it('is cleared by reset, so the next rehearsal starts unscoped', () => {
    const store = openScript();
    store.setScope('scene-1');
    store.reset();

    expect(store.scopeSceneId).toBeNull();
    expect(store.isSceneScoped).toBe(false);
  });
});

describe('cast', () => {
  it('offers only the roles that speak in the scoped scene', () => {
    const store = openScript();
    store.setScope('scene-1');

    expect(store.cast.map((item) => item.id)).toEqual(['harpagon']);
  });

  it('offers the whole cast for a whole-script rehearsal', () => {
    const store = openScript();

    expect(store.cast.map((item) => item.id)).toEqual(['harpagon', 'cleante']);
  });

  it('keeps every character when no line names one', () => {
    const store = openScript();
    useScriptStore().currentScript = {
      ...SCRIPT,
      scenes: [scene('scene-1', 0, [line('scene-1', null, 'Intră Harpagon.')])],
    };

    expect(store.cast.map((item) => item.id)).toEqual(['harpagon', 'cleante']);
  });
});
