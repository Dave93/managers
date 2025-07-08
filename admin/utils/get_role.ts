"use client";
import { apiClient } from "./eden";
import { useAuth } from "../components/useAuth";

export const useGetRole = (): string | null | undefined => {
  const { user } = useAuth();

  if (user) {
    const role = user.role;

    if (role) {
      return role.code;
    }
  } else {
    return undefined;
  }

  return null;
};
