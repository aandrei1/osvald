import {
  can,
  type Invitation,
  type InvitationPreview,
  type WorkspaceMember,
  type WorkspacePermission,
  type WorkspaceSummary,
} from '@osvald/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { api, toErrorMessage } from '@/services/api';

/**
 * The signed-in user's workspaces, the one they are working in, and its
 * members and invitations.
 *
 * The role decides which buttons show (`can`), using the same matrix the
 * server enforces. Hiding a button is only a convenience: the server checks the
 * role on every request.
 *
 * The chosen workspace is kept in `localStorage`, so a reload stays in it.
 */

const WORKSPACE_STORAGE_KEY = 'osvald.workspaceId';

/** Storage is unavailable in private windows and some WebViews. */
function readStoredWorkspaceId(): string | null {
  try {
    return window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredWorkspaceId(id: string | null): void {
  try {
    if (id === null) {
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, id);
    }
  } catch {
    // The choice then lasts only for this session.
  }
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const workspaces = ref<WorkspaceSummary[]>([]);
  const currentWorkspaceId = ref<string | null>(readStoredWorkspaceId());
  const members = ref<WorkspaceMember[]>([]);
  const invitations = ref<Invitation[]>([]);

  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const currentWorkspace = computed(
    () => workspaces.value.find((workspace) => workspace.id === currentWorkspaceId.value) ?? null,
  );

  /** Whether the caller's role in `workspaceId` grants `permission`. */
  function canIn(workspaceId: string, permission: WorkspacePermission): boolean {
    const workspace = workspaces.value.find((candidate) => candidate.id === workspaceId);
    return workspace !== undefined && can(workspace.role, permission);
  }

  /** Same, in the current workspace. */
  function canHere(permission: WorkspacePermission): boolean {
    return currentWorkspaceId.value !== null && canIn(currentWorkspaceId.value, permission);
  }

  function select(id: string | null): void {
    if (id !== currentWorkspaceId.value) {
      members.value = [];
      invitations.value = [];
    }
    currentWorkspaceId.value = id;
    writeStoredWorkspaceId(id);
  }

  function replaceSummary(updated: WorkspaceSummary): void {
    const index = workspaces.value.findIndex((workspace) => workspace.id === updated.id);
    workspaces.value =
      index >= 0
        ? workspaces.value.with(index, updated)
        : [...workspaces.value, updated].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Loads the list and keeps the stored choice when it is still one of them
   * (a member who was removed falls back to their first workspace).
   */
  async function fetchWorkspaces(): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await api.listWorkspaces();
      workspaces.value = response.items;

      const stillThere = response.items.some(
        (workspace) => workspace.id === currentWorkspaceId.value,
      );
      if (!stillThere) {
        select(response.items[0]?.id ?? null);
      }
    } catch (caught) {
      error.value = toErrorMessage(caught);
    } finally {
      isLoading.value = false;
    }
  }

  /** Loads the list once; later calls reuse it. */
  async function ensureLoaded(): Promise<void> {
    if (workspaces.value.length === 0) {
      await fetchWorkspaces();
    }
  }

  /** Creates a workspace, which the caller then edits, and switches to it. */
  async function createWorkspace(name: string): Promise<WorkspaceSummary | null> {
    error.value = null;

    try {
      const created = await api.createWorkspace(name);
      replaceSummary(created);
      select(created.id);
      return created;
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return null;
    }
  }

  async function renameWorkspace(id: string, name: string): Promise<boolean> {
    error.value = null;

    try {
      replaceSummary(await api.renameWorkspace(id, name));
      return true;
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return false;
    }
  }

  /** Members, and for the editor the open invitations too. */
  async function fetchPeople(workspaceId: string): Promise<void> {
    isLoading.value = true;
    error.value = null;

    try {
      const [memberList, invitationList] = await Promise.all([
        api.listMembers(workspaceId),
        canIn(workspaceId, 'workspace:invite')
          ? api.listInvitations(workspaceId)
          : Promise.resolve({ items: [] }),
      ]);
      members.value = memberList.items;
      invitations.value = invitationList.items;
    } catch (caught) {
      error.value = toErrorMessage(caught);
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Invites an address. Resolves to whether the e-mail went out, or `null`
   * when the invitation was refused (the error is set).
   */
  async function invite(
    workspaceId: string,
    email: string,
  ): Promise<{ emailSent: boolean } | null> {
    error.value = null;

    try {
      const sent = await api.invite(workspaceId, email);
      invitations.value = [
        sent.invitation,
        ...invitations.value.filter((invitation) => invitation.email !== sent.invitation.email),
      ];
      return { emailSent: sent.emailSent };
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return null;
    }
  }

  async function resendInvitation(
    workspaceId: string,
    invitationId: string,
  ): Promise<{ emailSent: boolean } | null> {
    error.value = null;

    try {
      const sent = await api.resendInvitation(workspaceId, invitationId);
      invitations.value = [
        sent.invitation,
        ...invitations.value.filter((invitation) => invitation.id !== invitationId),
      ];
      return { emailSent: sent.emailSent };
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return null;
    }
  }

  async function revokeInvitation(workspaceId: string, invitationId: string): Promise<boolean> {
    error.value = null;

    try {
      await api.revokeInvitation(workspaceId, invitationId);
      invitations.value = invitations.value.filter((invitation) => invitation.id !== invitationId);
      return true;
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return false;
    }
  }

  async function removeMember(workspaceId: string, userId: string): Promise<boolean> {
    error.value = null;

    try {
      await api.removeMember(workspaceId, userId);
      members.value = members.value.filter((member) => member.userId !== userId);
      const workspace = workspaces.value.find((candidate) => candidate.id === workspaceId);
      if (workspace !== undefined) {
        replaceSummary({ ...workspace, memberCount: Math.max(workspace.memberCount - 1, 1) });
      }
      return true;
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return false;
    }
  }

  /** Hands the editor role over; the caller's own role here becomes `member`. */
  async function transferEditor(workspaceId: string, userId: string): Promise<boolean> {
    error.value = null;

    try {
      const response = await api.transferEditor(workspaceId, userId);
      members.value = response.items;
      invitations.value = [];
      const workspace = workspaces.value.find((candidate) => candidate.id === workspaceId);
      if (workspace !== undefined) {
        replaceSummary({ ...workspace, role: 'member' });
      }
      return true;
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return false;
    }
  }

  /** What an invitation link is for. `null` when it cannot be loaded (the error is set). */
  async function previewInvitation(token: string): Promise<InvitationPreview | null> {
    error.value = null;

    try {
      return await api.previewInvitation(token);
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return null;
    }
  }

  /** Joins the invitation's workspace and switches to it. */
  async function acceptInvitation(token: string): Promise<WorkspaceSummary | null> {
    error.value = null;

    try {
      const { workspace } = await api.acceptInvitation(token);
      replaceSummary(workspace);
      select(workspace.id);
      return workspace;
    } catch (caught) {
      error.value = toErrorMessage(caught);
      return null;
    }
  }

  /** Forgets everything. Call when signing out, so the next account starts clean. */
  function clear(): void {
    workspaces.value = [];
    members.value = [];
    invitations.value = [];
    error.value = null;
    select(null);
  }

  return {
    workspaces,
    currentWorkspaceId,
    currentWorkspace,
    members,
    invitations,
    isLoading,
    error,
    canIn,
    canHere,
    select,
    fetchWorkspaces,
    ensureLoaded,
    createWorkspace,
    renameWorkspace,
    fetchPeople,
    invite,
    resendInvitation,
    revokeInvitation,
    removeMember,
    transferEditor,
    previewInvitation,
    acceptInvitation,
    clear,
  };
});
