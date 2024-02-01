"use client";
import { useSession } from "next-auth/react";

export const useGetRole = (): string | null | undefined => {
  const { data: session } = useSession();

  if (session) {
    const role = session.role;

    if (role) {
      return role.code;
    }
  } else {
    return undefined;
  }

  return null;
};
