// Role model: global superadmin + per-app manager/member
//
// - isSuperadmin (global flag on identity.users): bypasses all checks. Set once
//   by platform admins; grants full access to every app.
// - manager (per-app membership): can view and edit all CRM records and use
//   manager-only administration features.
// - member (per-app membership): can view and edit all CRM records so the team
//   can collaborate on one shared pipeline. Cannot delete or reassign records.
//
// Migration from old four-role model:
//   superadmin -> isSuperadmin=true + manager membership
//   manager    -> manager
//   outreach   -> member
//   viewer     -> member

export type CrmRole = 'manager' | 'member';

export interface CallerInfo {
  userId: string;
  managedUserIds?: string[];
  isSuperadmin?: boolean;
}

export interface ResourceInfo {
  ownerId: string;
}

export type CrmAction = 'view' | 'create' | 'edit' | 'delete' | 'reassign';

export function can(
  isSuperadmin: boolean,
  role: string,
  action: CrmAction,
  _resource: ResourceInfo,
  caller: CallerInfo
): boolean {
  if (isSuperadmin || caller.isSuperadmin) return true;

  const normalizedRole = role.toLowerCase();
  if (normalizedRole === 'manager') return true;
  if (normalizedRole === 'member') {
    return action !== 'delete' && action !== 'reassign';
  }
  return false;
}

export function canList(
  isSuperadmin: boolean,
  role: string,
  caller: CallerInfo,
  _resourceOwnerId?: string
): boolean {
  if (isSuperadmin || caller.isSuperadmin) return true;
  const normalizedRole = role.toLowerCase();
  if (normalizedRole === 'manager' || normalizedRole === 'member') return true;
  return false;
}
