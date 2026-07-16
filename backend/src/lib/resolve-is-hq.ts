// Explicit HQ marker — super-user, or the caller's role holds attestation.hq.
// Never inferred from empty terminal scope (that would be fail-open).
export async function resolveIsHq(args: {
  user: { is_super_user?: boolean | null } | null;
  role: { id: string } | null;
  cacheController: {
    getPermissionsByRoleId: (roleId: string) => Promise<string[]>;
  };
}): Promise<boolean> {
  if (args.user?.is_super_user === true) return true;
  if (!args.role) return false;
  const perms = await args.cacheController.getPermissionsByRoleId(args.role.id);
  return perms.includes("attestation.hq");
}
