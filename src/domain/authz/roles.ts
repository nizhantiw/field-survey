export const ROLES = ['owner', 'admin', 'researcher', 'fieldworker', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = {
  owner: 5,
  admin: 4,
  researcher: 3,
  fieldworker: 2,
  viewer: 1,
};

export function roleRank(role: Role): number {
  return RANK[role];
}

export function canPublish(role: Role): boolean {
  return roleRank(role) >= roleRank('researcher');
}

export function canManageMembers(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

export function canReview(role: Role): boolean {
  return roleRank(role) >= roleRank('researcher');
}

export function canCollect(role: Role): boolean {
  return roleRank(role) >= roleRank('fieldworker');
}

export function canExport(role: Role): boolean {
  return roleRank(role) >= roleRank('viewer');
}

export function canCreateProject(role: Role): boolean {
  return roleRank(role) >= roleRank('researcher');
}

/**
 * Mirrors the membership update rules enforced by SQL policies.
 * A user cannot change their own role. Admins cannot touch owners or grant owner.
 */
export function canAssignRole(actor: Role, targetCurrent: Role, next: Role, isSelf: boolean): boolean {
  if (isSelf) return false;
  if (actor === 'owner') return true;
  if (actor === 'admin') {
    if (targetCurrent === 'owner') return false;
    return next !== 'owner';
  }
  return false;
}

export function isLastOwnerRemoval(ownerCount: number, targetIsOwner: boolean, nextRole: Role | null): boolean {
  if (!targetIsOwner) return false;
  if (ownerCount > 1) return false;
  return nextRole === null || nextRole !== 'owner';
}
