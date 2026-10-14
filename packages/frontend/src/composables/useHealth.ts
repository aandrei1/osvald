import type { HealthResponse } from '@osvald/shared';
import { ref } from 'vue';

import { api, toErrorMessage } from '@/services/api';

/**
 * App-load wiring example.
 *
 * `App.vue` calls `refreshHealth()` on mount and `HealthStatusCard` renders the
 * result — the smallest possible proof that Vue + Pinia-free state + the typed
 * API client + the shared Zod schemas line up with the Fastify backend.
 *
 * Module-level state is intentional: "the backend health for this app session"
 * is a singleton. Promote it to a Pinia store if it grows beyond this.
 */

const health = ref<HealthResponse | null>(null);
const isLoading = ref(false);
const error = ref<string | null>(null);

async function refreshHealth(): Promise<void> {
  isLoading.value = true;
  error.value = null;

  try {
    health.value = await api.getHealth();
  } catch (caught) {
    health.value = null;
    error.value = toErrorMessage(caught);
  } finally {
    isLoading.value = false;
  }
}

export function useHealth() {
  return { health, isLoading, error, refreshHealth };
}
