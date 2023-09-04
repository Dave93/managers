"use client";
import { useSession } from "next-auth/react";

export const useGetRole = (): string | null | undefined => {
  const { data: session } = useSession();

  if (session) {
    const roles = session.users_roles_usersTousers_roles_user_id[0];

    if (roles) {
      return roles.roles.code!;
    }
  } else {
    return undefined;
  }

  return null;
};
