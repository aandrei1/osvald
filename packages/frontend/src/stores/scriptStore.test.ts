import type { Script, ScriptDetail } from '@osvald/shared';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listScripts: vi.fn(),
  getScript: vi.fn(),
  uploadScript: vi.fn(),
  reparseScript: vi.fn(),
  deleteScript: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  api,
  toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : 'Unexpected error'),
}));

import { useScriptStore } from './scriptStore';

const SCRIPT: Script = {
  id: '7f5d0f8e-6e1a-4f1e-9b2a-1c2d3e4f5a6b',
  userId: '7f5d0f8e-6e1a-4f1e-9b2a-1c2d3e4f5a6e',
  title: 'Avarul',
  author: 'Molière',
  description: null,
  status: 'parsed',
  sourceFileName: 'avarul.pdf',
  pageCount: 286,
  parseError: null,
  createdAt: '2026-10-18T12:00:00.000Z',
  updatedAt: '2026-10-18T12:00:00.000Z',
};

const DETAIL: ScriptDetail = { ...SCRIPT, scenes: [], characters: [] };

beforeEach(() => {
  setActivePinia(createPinia());
  api.listScripts.mockReset();
  api.getScript.mockReset();
  api.uploadScript.mockReset();
  api.reparseScript.mockReset();
  api.deleteScript.mockReset();
});

afterEach(() => {
  // Polling timers must not outlive a test.
  useScriptStore().stopWatching();
});

describe('fetchScripts', () => {
  it('loads the library and reports the total', async () => {
    api.listScripts.mockResolvedValue({ items: [SCRIPT], total: 1 });

    const store = useScriptStore();
    await store.fetchScripts();

    expect(store.scripts).toEqual([SCRIPT]);
    expect(store.total).toBe(1);
    expect(store.isLoading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('surfaces a failure as a readable error', async () => {
    api.listScripts.mockRejectedValue(new Error('Network down'));

    const store = useScriptStore();
    await store.fetchScripts();

    expect(store.scripts).toEqual([]);
    expect(store.error).toBe('Network down');
    expect(store.isLoading).toBe(false);
  });
});

describe('fetchScriptDetail', () => {
  it('caches the open script until a force refresh', async () => {
    api.getScript.mockResolvedValue(DETAIL);

    const store = useScriptStore();
    await store.fetchScriptDetail(SCRIPT.id);
    await store.fetchScriptDetail(SCRIPT.id);

    expect(api.getScript).toHaveBeenCalledTimes(1);
    expect(store.currentScript).toEqual(DETAIL);

    await store.fetchScriptDetail(SCRIPT.id, { force: true });
    expect(api.getScript).toHaveBeenCalledTimes(2);
  });

  it('clears the open script when the request fails', async () => {
    api.getScript.mockRejectedValue(new Error('Not found'));

    const store = useScriptStore();
    await store.fetchScriptDetail(SCRIPT.id);

    expect(store.currentScript).toBeNull();
    expect(store.error).toBe('Not found');
  });
});

describe('uploadScript', () => {
  it('adds the uploaded script and starts watching the parse', async () => {
    api.uploadScript.mockResolvedValue({
      script: SCRIPT,
      jobId: 'job-1',
      queueName: 'script-parsing',
    });

    const store = useScriptStore();
    const uploaded = await store.uploadScript({
      file: new File(['%PDF-1.7'], 'avarul.pdf', { type: 'application/pdf' }),
    });

    expect(uploaded).toEqual(SCRIPT);
    expect(store.scripts).toEqual([SCRIPT]);
    expect(store.parsingIds).toContain(SCRIPT.id);
  });

  it('returns null and records the error when the upload fails', async () => {
    api.uploadScript.mockRejectedValue(new Error('Only PDF files are supported'));

    const store = useScriptStore();
    const uploaded = await store.uploadScript({
      file: new File(['not a pdf'], 'notes.txt', { type: 'text/plain' }),
    });

    expect(uploaded).toBeNull();
    expect(store.error).toBe('Only PDF files are supported');
  });
});

describe('reparseScript', () => {
  it('merges the new status and resumes watching the parse', async () => {
    api.reparseScript.mockResolvedValue({
      script: { ...SCRIPT, status: 'uploaded' },
      jobId: 'job-2',
      queueName: 'script-parsing',
    });

    const store = useScriptStore();
    await expect(store.reparseScript(SCRIPT.id)).resolves.toBe(true);

    expect(store.scripts[0]?.status).toBe('uploaded');
    expect(store.parsingIds).toContain(SCRIPT.id);
  });
});

describe('deleteScript', () => {
  it('removes the script from the library and closes it', async () => {
    api.listScripts.mockResolvedValue({ items: [SCRIPT], total: 1 });
    api.getScript.mockResolvedValue(DETAIL);
    api.deleteScript.mockResolvedValue(null);

    const store = useScriptStore();
    await store.fetchScripts();
    await store.fetchScriptDetail(SCRIPT.id);

    await expect(store.deleteScript(SCRIPT.id)).resolves.toBe(true);

    expect(store.scripts).toEqual([]);
    expect(store.total).toBe(0);
    expect(store.currentScript).toBeNull();
  });

  it('keeps the library intact when the delete fails', async () => {
    api.listScripts.mockResolvedValue({ items: [SCRIPT], total: 1 });
    api.deleteScript.mockRejectedValue(new Error('Not found'));

    const store = useScriptStore();
    await store.fetchScripts();

    await expect(store.deleteScript(SCRIPT.id)).resolves.toBe(false);

    expect(store.scripts).toEqual([SCRIPT]);
    expect(store.error).toBe('Not found');
  });
});
