import { useSession } from "next-auth/react";

export const useCanAccess = (permission: string) => {
  const { data: session, status } = useSession();
  if (!session) {
    return false;
  }

  if (!session.rights) {
    return false;
  }

  if (!session.rights.includes(permission)) {
    return false;
  }

  return true;
};
