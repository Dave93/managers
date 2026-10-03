import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../utils/eden";

// Returns true when the current user has `permission`. Uses the cookie-session
// /users/my_permissions endpoint (the rest of the app is on cookie auth, not
// next-auth) — this used to destructure `useSession()` from next-auth and crash
// because no SessionProvider exists at the root.
export const useCanAccess = (permission: string) => {
  const { data } = useQuery({
    queryKey: ["my_permissions"],
    queryFn: async () => {
      const response = await apiClient.api.users.my_permissions.get();
      return response.data;
    },
  });
  const perms: string[] | undefined = (data as any)?.permissions;
  if (!perms) return false;
  return perms.includes(permission);
};
