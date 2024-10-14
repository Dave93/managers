import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../utils/eden";

export default function CanAccess({
  children,
  permission,
}: {
  children: React.ReactNode;
  permission: string;
}) {
  const { data: permissions } = useQuery({
    queryKey: ["my_permissions"],
    queryFn: async () => {
      const response = await apiClient.api.users.my_permissions.get();
      return response.data;
    },
  });

  if (!permissions) {
    return <></>;
  }

  if (!permissions.permissions) {
    return <></>;
  }

  if (!permissions.permissions.includes(permission)) {
    return <></>;
  }

  return <>{children}</>;
}
