import type { Invitation, WorkspaceSummary } from '@osvald/shared';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  listMembers: vi.fn(),
  listInvitations: vi.fn(),
  invite: vi.fn(),
  transferEditor: vi.fn(),
  acceptInvitation: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  api,
  toErrorMessage: (error: unknown) => (error instanceof Error ? error.message : 'Unexpected error'),
}));

import { useWorkspaceStore } from './workspaceStore';

const STORAGE_KEY = 'osvald.workspaceId';

function summary(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    id: '0b6f2a52-3c1d-4e5f-8a9b-0c1d2e3f4a5b',
    name: "Ana's workspace",
    role: 'editor',
    memberCount: 1,
    createdAt: '2026-11-03T10:00:00.000Z',
    updatedAt: '2026-11-03T10:00:00.000Z',
    ...overrides,
  };
}

const PERSONAL = summary();
const SALEM = summary({
  id: '1c7e3b63-4d2e-4f60-9bac-1d2e3f4a5b6c',
  name: 'Salem',
  role: 'member',
  memberCount: 4,
});

const INVITATION: Invitation = {
  id: '2d8f4c74-5e3f-4a71-8cbd-2e3f4a5b6c7d',
  workspaceId: PERSONAL.id,
  email: 'ioana@example.com',
  status: 'pending',
  expiresAt: '2026-11-10T10:00:00.000Z',
  createdAt: '2026-11-03T10:00:00.000Z',
};

beforeEach(() => {
  setActivePinia(createPinia());
  window.localStorage.clear();
  for (const mock of Object.values(api)) {
    mock.mockReset();
  }
});

describe('fetchWorkspaces', () => {
  it('picks the first workspace when none was chosen before', async () => {
    api.listWorkspaces.mockResolvedValue({ items: [PERSONAL, SALEM] });

    const store = useWorkspaceStore();
    await store.fetchWorkspaces();

    expect(store.currentWorkspaceId).toBe(PERSONAL.id);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(PERSONAL.id);
  });

  it('keeps the stored choice across a reload', async () => {
    window.localStorage.setItem(STORAGE_KEY, SALEM.id);
    api.listWorkspaces.mockResolvedValue({ items: [PERSONAL, SALEM] });

    const store = useWorkspaceStore();
    await store.fetchWorkspaces();

    expect(store.currentWorkspace?.name).toBe('Salem');
  });

  it('falls back when the stored workspace is no longer one of them', async () => {
    window.localStorage.setItem(STORAGE_KEY, SALEM.id);
    api.listWorkspaces.mockResolvedValue({ items: [PERSONAL] });

    const store = useWorkspaceStore();
    await store.fetchWorkspaces();

    expect(store.currentWorkspaceId).toBe(PERSONAL.id);
  });
});

describe('permissions', () => {
  it('follows the role of each workspace', async () => {
    api.listWorkspaces.mockResolvedValue({ items: [PERSONAL, SALEM] });

    const store = useWorkspaceStore();
    await store.fetchWorkspaces();

    expect(store.canIn(PERSONAL.id, 'script:import')).toBe(true);
    expect(store.canIn(SALEM.id, 'script:import')).toBe(false);
    expect(store.canIn(SALEM.id, 'script:read')).toBe(true);
    expect(store.canIn('unknown', 'script:read')).toBe(false);

    store.select(SALEM.id);
    expect(store.canHere('workspace:invite')).toBe(false);
  });

  it('drops the editor rights after handing the role over', async () => {
    api.listWorkspaces.mockResolvedValue({ items: [PERSONAL] });
    api.transferEditor.mockResolvedValue({ items: [] });

    const store = useWorkspaceStore();
    await store.fetchWorkspaces();
    await store.transferEditor(PERSONAL.id, SALEM.id);

    expect(store.canHere('script:import')).toBe(false);
    expect(store.currentWorkspace?.role).toBe('member');
  });
});

describe('people', () => {
  it('loads invitations only for the editor', async () => {
    api.listWorkspaces.mockResolvedValue({ items: [PERSONAL, SALEM] });
    api.listMembers.mockResolvedValue({ items: [] });
    api.listInvitations.mockResolvedValue({ items: [INVITATION] });

    const store = useWorkspaceStore();
    await store.fetchWorkspaces();

    await store.fetchPeople(SALEM.id);
    expect(api.listInvitations).not.toHaveBeenCalled();

    await store.fetchPeople(PERSONAL.id);
    expect(store.invitations).toEqual([INVITATION]);
  });

  it('replaces an older invitation to the same address', async () => {
    const newer = { ...INVITATION, id: '3e9a5d85-6f4a-4b82-9dce-3f4a5b6c7d8e' };
    api.invite.mockResolvedValue({ invitation: newer, emailSent: false });

    const store = useWorkspaceStore();
    store.invitations = [INVITATION];

    await expect(store.invite(PERSONAL.id, INVITATION.email)).resolves.toEqual({
      emailSent: false,
    });
    expect(store.invitations).toEqual([newer]);
  });
});

describe('acceptInvitation', () => {
  it('joins the workspace and switches to it', async () => {
    api.acceptInvitation.mockResolvedValue({ workspace: SALEM });

    const store = useWorkspaceStore();
    await store.acceptInvitation('a'.repeat(43));

    expect(store.workspaces).toEqual([SALEM]);
    expect(store.currentWorkspaceId).toBe(SALEM.id);
  });

  it('keeps the error when the link no longer works', async () => {
    api.acceptInvitation.mockRejectedValue(new Error('This invitation was already used'));

    const store = useWorkspaceStore();

    await expect(store.acceptInvitation('a'.repeat(43))).resolves.toBeNull();
    expect(store.error).toBe('This invitation was already used');
  });
});

describe('createWorkspace', () => {
  it('adds the new workspace and switches to it', async () => {
    const created = summary({ id: '4fab6e96-7a5b-4c93-8edf-4a5b6c7d8e9f', name: 'Teatrul Mic' });
    api.createWorkspace.mockResolvedValue(created);

    const store = useWorkspaceStore();
    await store.createWorkspace('Teatrul Mic');

    expect(store.currentWorkspace).toEqual(created);
  });
});

describe('clear', () => {
  it('forgets the workspaces and the stored choice', async () => {
    api.listWorkspaces.mockResolvedValue({ items: [PERSONAL] });

    const store = useWorkspaceStore();
    await store.fetchWorkspaces();
    store.clear();

    expect(store.workspaces).toEqual([]);
    expect(store.currentWorkspaceId).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
