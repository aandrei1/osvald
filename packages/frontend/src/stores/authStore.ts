import type { User } from '@osvald/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { api, setAuthTokenProvider, setUnauthorizedHandler, toErrorMessage } from '@/services/api';

/**
 * Session state: the access token and the signed-in user.
 *
 * The token is kept in `localStorage` so a reload does not sign the actor out
 * mid-rehearsal.
 *
 * TODO(auth): on native, move the token to the Keychain/Keystore via
 * `@capacitor/preferences` with encryption — `localStorage` in a Capacitor
 * WebView is readable by anything with filesystem access to the app container.
 * Also switch to a short-lived access token plus a refresh token once
 * `POST /auth/refresh` exists; a long-lived token in web storage is the weak
 * point of this prototype.
 */

const TOKEN_STORAGE_KEY = 'osvald.accessToken';

/** Storage is unavailable in private windows and some WebViews. */
function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token === null) {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    } else {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // A session that lives only in memory is still usable.
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(readStoredToken());
  const user = ref<User | null>(null);
  const isSubmitting = ref(false);
  /** True while the stored token is being exchanged for a user on boot. */
  const isRestoring = ref(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => token.value !== null && user.value !== null);

  function setSession(nextToken: string | null, nextUser: User | null): void {
    token.value = nextToken;
    user.value = nextUser;
    writeStoredToken(nextToken);
  }

  function signOut(): void {
    setSession(null, null);
    error.value = null;
  }

  // Hand the client a way to read the current token, and a way to tell us the
  // token was rejected. Registered once at store creation.
  setAuthTokenProvider(() => token.value);
  setUnauthorizedHandler(() => {
    if (token.value !== null) {
      setSession(null, null);
      error.value = 'Your session expired — please sign in again.';
    }
  });

  /**
   * Turns a stored token back into a session on app load.
   *
   * A token that the API rejects is discarded by the unauthorized handler, so a
   * stale one cannot leave the app in a half-signed-in state.
   */
  async function restoreSession(): Promise<void> {
    if (token.value === null || user.value !== null) {
      return;
    }

    isRestoring.value = true;

    try {
      const response = await api.me();
      user.value = response.user;
    } catch {
      // Already cleared by the unauthorized handler if it was an auth failure;
      // a network error leaves the token in place for the next attempt.
      user.value = null;
    } finally {
      isRestoring.value = false;
    }
  }

  async function signIn(email: string, password: string): Promise<boolean> {
    isSubmitting.value = true;
    error.value = null;

    try {
      const response = await api.login({ email, password });
      setSession(response.accessToken, response.user);
      return true;
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return false;
    } finally {
      isSubmitting.value = false;
    }
  }

  async function signUp(
    email: string,
    password: string,
    displayName: string | null,
  ): Promise<boolean> {
    isSubmitting.value = true;
    error.value = null;

    try {
      const response = await api.register({ email, password, displayName });
      setSession(response.accessToken, response.user);
      return true;
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return false;
    } finally {
      isSubmitting.value = false;
    }
  }

  return {
    token,
    user,
    isSubmitting,
    isRestoring,
    error,
    isAuthenticated,
    restoreSession,
    signIn,
    signUp,
    signOut,
  };
});
