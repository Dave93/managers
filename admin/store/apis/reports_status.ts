import { trpc, ReactQueryOptions, RouterInputs } from "@admin/utils/trpc";

export function useReportsStatusQuery(
  filter: RouterInputs["reportsStatus"]["list"]
) {
  return trpc.reportsStatus.list.useQuery(filter);
}

export function useReportsStatusCachedQuery(
  filter: RouterInputs["reportsStatus"]["cachedReportsStatus"]
) {
  return trpc.reportsStatus.cachedReportsStatus.useQuery(filter);
}

export function useReportsStatusCreate(
  options: ReactQueryOptions["reportsStatus"]["add"]
) {
  const utils = trpc.useContext();
  return trpc.reportsStatus.add.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.reportsStatus.list.invalidate();

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

export function useReportsStatusUpdate(
  options: ReactQueryOptions["reportsStatus"]["renew"]
) {
  const utils = trpc.useContext();
  return trpc.reportsStatus.renew.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.reportsStatus.list.invalidate();

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

export function useReportsStatusDestroy(
  options: ReactQueryOptions["reportsStatus"]["delete"]
) {
  const utils = trpc.useContext();
  return trpc.reportsStatus.delete.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.reportsStatus.list.invalidate();

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
