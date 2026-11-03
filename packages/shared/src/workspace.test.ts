import { describe, expect, it } from 'vitest';

import {
  ROLE_PERMISSIONS,
  WORKSPACE_PERMISSIONS,
  WORKSPACE_ROLES,
  can,
  invitationTokenSchema,
  workspaceNameSchema,
  type WorkspacePermission,
} from './workspace.js';

/**
 * The permission matrix is the contract both sides read: the backend enforces
 * it on every command, the frontend uses it to hide buttons. These tests pin
 * the decisions in `docs/plans/script-production-flow.md`.
 */

describe('ROLE_PERMISSIONS', () => {
  it('has a row for every role', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...WORKSPACE_ROLES].sort());
  });

  it('gives the editor every permission', () => {
    for (const permission of WORKSPACE_PERMISSIONS) {
      expect(can('editor', permission)).toBe(true);
    }
  });

  it('lets a member only read and rehearse', () => {
    const granted = WORKSPACE_PERMISSIONS.filter((permission) => can('member', permission));
    expect(granted).toEqual<WorkspacePermission[]>(['workspace:read', 'script:read']);
  });
});

describe('workspaceNameSchema', () => {
  it('trims the name', () => {
    expect(workspaceNameSchema.parse('  Teatrul Mic  ')).toBe('Teatrul Mic');
  });

  it('rejects a name that is only whitespace', () => {
    expect(workspaceNameSchema.safeParse('   ').success).toBe(false);
  });
});

describe('invitationTokenSchema', () => {
  it('accepts a base64url token', () => {
    expect(invitationTokenSchema.safeParse('a'.repeat(43)).success).toBe(true);
  });

  it('rejects characters outside base64url', () => {
    expect(invitationTokenSchema.safeParse(`${'a'.repeat(42)}/`).success).toBe(false);
  });
});
