import type { Script, ScriptDetail } from '@osvald/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { api, toErrorMessage, type UploadScriptInput } from '@/services/api';

/**
 * The script library and the currently opened script.
 *
 * Parsing happens on a queue worker, so an upload returns before there is
 * anything to rehearse. `watchParsing()` exists for that gap: it polls the
 * script until it settles into `parsed` or `failed`, which is what lets the UI
 * show progress instead of an empty scene list.
 */

/** How often to re-check a script that is still being parsed. */
const POLL_INTERVAL_MS = 1_500;
/** Stop polling eventually, so a stuck worker cannot spin forever. */
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

const PENDING_STATUSES = new Set<Script['status']>(['uploaded', 'parsing']);

export const useScriptStore = defineStore('script', () => {
  const scripts = ref<Script[]>([]);
  const total = ref(0);
  const currentScript = ref<ScriptDetail | null>(null);

  const isLoading = ref(false);
  const isUploading = ref(false);
  const error = ref<string | null>(null);
  /** Ids currently being polled, so the UI can show a parsing indicator. */
  const parsingIds = ref<string[]>([]);

  const isEmpty = computed(() => !isLoading.value && scripts.value.length === 0);

  /** Timers keyed by script id, so leaving a page can cancel its poll. */
  const pollTimers = new Map<string, ReturnType<typeof setTimeout>>();

  async function fetchScripts(): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await api.listScripts();
      scripts.value = response.items;
      total.value = response.total;

      // Resume watching anything the server still reports as unfinished — for
      // instance after a page reload during a long parse.
      for (const script of response.items) {
        if (PENDING_STATUSES.has(script.status)) {
          watchParsing(script.id);
        }
      }
    } catch (caught) {
      error.value = toErrorMessage(caught);
    } finally {
      isLoading.value = false;
    }
  }

  async function fetchScriptDetail(id: string, options: { force?: boolean } = {}): Promise<void> {
    if (!options.force && currentScript.value?.id === id) {
      return;
    }

    isLoading.value = true;
    error.value = null;

    try {
      currentScript.value = await api.getScript(id);
    } catch (caught) {
      currentScript.value = null;
      error.value = toErrorMessage(caught);
    } finally {
      isLoading.value = false;
    }
  }

  /** Replaces a script in the list, and in `currentScript` when it is open. */
  function mergeScript(updated: Script): void {
    const index = scripts.value.findIndex((script) => script.id === updated.id);

    if (index >= 0) {
      scripts.value = scripts.value.with(index, updated);
    } else {
      scripts.value = [updated, ...scripts.value];
      total.value += 1;
    }

    if (currentScript.value?.id === updated.id) {
      currentScript.value = { ...currentScript.value, ...updated };
    }
  }

  /**
   * Polls one script until parsing finishes.
   *
   * The detail endpoint is used rather than the list so that the open script's
   * scenes and characters arrive in the same response that reports `parsed` —
   * otherwise the UI would flip to "ready" a moment before it has lines.
   */
  function watchParsing(id: string): void {
    if (pollTimers.has(id)) {
      return;
    }

    if (!parsingIds.value.includes(id)) {
      parsingIds.value = [...parsingIds.value, id];
    }

    const startedAt = Date.now();

    const stop = (): void => {
      const timer = pollTimers.get(id);
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      pollTimers.delete(id);
      parsingIds.value = parsingIds.value.filter((pending) => pending !== id);
    };

    const check = async (): Promise<void> => {
      try {
        const detail = await api.getScript(id);
        mergeScript(detail);

        if (currentScript.value?.id === id) {
          currentScript.value = detail;
        }

        if (!PENDING_STATUSES.has(detail.status)) {
          stop();
          return;
        }
      } catch (caught) {
        // A transient failure should not abandon the watch; a timeout ends it.
        error.value = toErrorMessage(caught);
      }

      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        stop();
        error.value = 'Parsing is taking unusually long — check that the queue worker is running.';
        return;
      }

      pollTimers.set(
        id,
        setTimeout(() => void check(), POLL_INTERVAL_MS),
      );
    };

    pollTimers.set(
      id,
      setTimeout(() => void check(), POLL_INTERVAL_MS),
    );
  }

  /** Stops every poll. Call when signing out. */
  function stopWatching(): void {
    for (const timer of pollTimers.values()) {
      clearTimeout(timer);
    }
    pollTimers.clear();
    parsingIds.value = [];
  }

  /** Uploads a PDF, then watches it through the parsing pipeline. */
  async function uploadScript(input: UploadScriptInput): Promise<Script | null> {
    isUploading.value = true;
    error.value = null;

    try {
      const response = await api.uploadScript(input);
      mergeScript(response.script);
      watchParsing(response.script.id);
      return response.script;
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return null;
    } finally {
      isUploading.value = false;
    }
  }

  /** Re-runs the parser over the stored PDF, e.g. after a failure. */
  async function reparseScript(id: string): Promise<boolean> {
    error.value = null;

    try {
      const response = await api.reparseScript(id);
      mergeScript(response.script);
      watchParsing(id);
      return true;
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return false;
    }
  }

  async function deleteScript(id: string): Promise<boolean> {
    error.value = null;

    try {
      await api.deleteScript(id);

      scripts.value = scripts.value.filter((script) => script.id !== id);
      total.value = Math.max(total.value - 1, 0);

      if (currentScript.value?.id === id) {
        currentScript.value = null;
      }

      return true;
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return false;
    }
  }

  /** Re-reads the open script. */
  async function refreshCurrentScript(): Promise<void> {
    const id = currentScript.value?.id;
    if (id === undefined) {
      return;
    }
    await fetchScriptDetail(id, { force: true });
  }

  function clear(): void {
    stopWatching();
    scripts.value = [];
    total.value = 0;
    currentScript.value = null;
    error.value = null;
  }

  /*
   * TODO(scripts):
   *   - renameScript()
   *   - offline cache of parsed scripts (Capacitor Filesystem + a local index)
   *   - replace polling with a server-sent event stream carrying the job's
   *     BullMQ progress, so the UI can show a percentage instead of a spinner
   */

  return {
    scripts,
    total,
    currentScript,
    isLoading,
    isUploading,
    error,
    parsingIds,
    isEmpty,
    fetchScripts,
    fetchScriptDetail,
    uploadScript,
    reparseScript,
    deleteScript,
    refreshCurrentScript,
    watchParsing,
    stopWatching,
    clear,
  };
});
