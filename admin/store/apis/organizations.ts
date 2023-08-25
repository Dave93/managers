import { trpc, ReactQueryOptions } from "@admin/utils/trpc";

export function useOrganizationsQuery(filter: any) {
  return trpc.organization.list.useQuery(filter);
}

export function useOrganizationsCreate(
  options: ReactQueryOptions["organization"]["add"]
) {
  const utils = trpc.useContext();
  return trpc.organization.add.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.organization.list.invalidate();

      options?.onSuccess?.(
        post,
        {
          data: post,
        },
        {}
      );
    },
  });
}

export function useOrganizationsUpdate(
  options: ReactQueryOptions["organization"]["renew"]
) {
  const utils = trpc.useContext();
  return trpc.organization.renew.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.organization.list.invalidate();

      options?.onSuccess?.(
        post,
        {
          data: post,
          where: {
            id: post.id,
          },
        },
        {}
      );
    },
  });
}

export function useOrganizationsDestroy(
  options: ReactQueryOptions["organization"]["delete"]
) {
  const utils = trpc.useContext();
  return trpc.organization.delete.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.organization.list.invalidate();

      options?.onSuccess?.(
        post,
        {
          where: {
            id: post.id,
          },
        },
        {}
      );
    },
  });
}
