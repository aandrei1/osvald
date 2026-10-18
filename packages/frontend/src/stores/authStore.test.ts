import type { User } from '@osvald/shared';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The API client is mocked: these tests are about the session state machine
 * (token → storage → user) and not about HTTP.
 */
const api = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  me: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  api,
  setAuthTokenProvider: vi.fn(),
  setUnauthorizedHandler: vi.fn(),
  toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : 'Unexpected error'),
}));

import { useAuthStore } from './authStore';

const TOKEN_KEY = 'osvald.accessToken';

const USER: User = {
  id: '7f5d0f8e-6e1a-4f1e-9b2a-1c2d3e4f5a6b',
  email: 'actor@example.com',
  displayName: 'Actor',
  createdAt: '2026-10-18T12:00:00.000Z',
  updatedAt: '2026-10-18T12:00:00.000Z',
};

beforeEach(() => {
  setActivePinia(createPinia());
  window.localStorage.clear();
  api.login.mockReset();
  api.register.mockReset();
  api.me.mockReset();
});

describe('signIn', () => {
  it('stores the session and persists the token', async () => {
    api.login.mockResolvedValue({ user: USER, accessToken: 'jwt-token', expiresIn: 3600 });

    const store = useAuthStore();
    await expect(store.signIn('actor@example.com', 'secret')).resolves.toBe(true);

    expect(store.isAuthenticated).toBe(true);
    expect(store.user).toEqual(USER);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBe('jwt-token');
  });

  it('keeps the previous session out of storage on failure', async () => {
    api.login.mockRejectedValue(new Error('Incorrect e-mail address or password'));

    const store = useAuthStore();
    await expect(store.signIn('actor@example.com', 'wrong')).resolves.toBe(false);

    expect(store.isAuthenticated).toBe(false);
    expect(store.error).toBe('Incorrect e-mail address or password');
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe('signUp', () => {
  it('treats a successful registration as a signed-in session', async () => {
    api.register.mockResolvedValue({ user: USER, accessToken: 'new-token', expiresIn: 3600 });

    const store = useAuthStore();
    await expect(store.signUp('actor@example.com', 'secret', 'Actor')).resolves.toBe(true);

    expect(store.token).toBe('new-token');
    expect(store.user).toEqual(USER);
  });
});

describe('signOut', () => {
  it('clears the user, the token and the stored copy', async () => {
    api.login.mockResolvedValue({ user: USER, accessToken: 'jwt-token', expiresIn: 3600 });

    const store = useAuthStore();
    await store.signIn('actor@example.com', 'secret');

    store.signOut();

    expect(store.token).toBeNull();
    expect(store.user).toBeNull();
    expect(store.isAuthenticated).toBe(false);
    expect(window.localStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});

describe('restoreSession', () => {
  it('exchanges a stored token for the current user', async () => {
    window.localStorage.setItem(TOKEN_KEY, 'stored-token');
    api.me.mockResolvedValue({ user: USER });

    const store = useAuthStore();
    await store.restoreSession();

    expect(api.me).toHaveBeenCalledTimes(1);
    expect(store.user).toEqual(USER);
    expect(store.isAuthenticated).toBe(true);
  });

  it('does nothing when there is no stored token', async () => {
    const store = useAuthStore();
    await store.restoreSession();

    expect(api.me).not.toHaveBeenCalled();
    expect(store.user).toBeNull();
  });
});
