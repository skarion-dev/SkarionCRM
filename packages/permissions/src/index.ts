// Role model: global superadmin + per-app manager/member
//
// - isSuperadmin (global flag on identity.users): bypasses all checks. Set once
//   by platform admins; grants full access to every app.
// - manager (per-app membership): can view all records, create, edit/delete
//   own + managed-team records. Reassign allowed for own/managed.
// - member (per-app membership): can view all records, create, edit own records.
//   Cannot delete or reassign anything. Own-only list filtering.
//
// Migration from old four-role model:
//   superadmin -> isSuperadmin=true + manager membership
//   manager    -> manager
//   outreach   -> member
//   viewer     -> member

export type CrmRole = "manager" | "member";

export interface CallerInfo {
  userId: string;
  managedUserIds?: string[];
  isSuperadmin?: boolean;
}

export interface ResourceInfo {
  ownerId: string;
}

export type CrmAction = "view" | "create" | "edit" | "delete" | "reassign";

export function can(
  isSuperadmin: boolean,
  role: string,
  action: CrmAction,
  resource: ResourceInfo,
  caller: CallerInfo
): boolean {
  if (isSuperadmin || caller.isSuperadmin) return true;

  const normalizedRole = role.toLowerCase();
  if (normalizedRole === "manager") {
    if (action === "view") return true;
    const isOwnResource = resource.ownerId === caller.userId;
    const isManagedResource = caller.managedUserIds?.includes(resource.ownerId) ?? false;
    if (isOwnResource || isManagedResource) return true;
    return false;
  }
  if (normalizedRole === "member") {
    const isOwnResource = resource.ownerId === caller.userId;
    if (!isOwnResource) return false;
    return action !== "delete" && action !== "reassign";
  }
  return false;
}

export function canList(
  isSuperadmin: boolean,
  role: string,
  caller: CallerInfo,
  resourceOwnerId?: string
): boolean {
  if (isSuperadmin || caller.isSuperadmin) return true;
  const normalizedRole = role.toLowerCase();
  if (normalizedRole === "manager") return true;
  if (normalizedRole === "member") {
    return resourceOwnerId === undefined || resourceOwnerId === caller.userId;
  }
  return false;
}
