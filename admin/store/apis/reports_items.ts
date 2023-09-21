import { trpc, ReactQueryOptions, RouterInputs } from "@admin/utils/trpc";

export function useReportsItemsQuery(
  filter: RouterInputs["reportsItems"]["list"],
  options?: ReactQueryOptions["reportsItems"]["list"]
) {
  return trpc.reportsItems.list.useQuery(filter, options);
}

export function useReportsItemsCreate(
  options: ReactQueryOptions["reportsItems"]["add"]
) {
  const utils = trpc.useContext();
  return trpc.reportsItems.add.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.reportsItems.list.invalidate();

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

export function useReportsItemsUpdate(
  options: ReactQueryOptions["reportsItems"]["renew"]
) {
  const utils = trpc.useContext();
  return trpc.reportsItems.renew.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.reports.list.invalidate();
      utils.reportsItems.list.invalidate();

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

export function useReportsItemsDestroy(
  options: ReactQueryOptions["reportsItems"]["delete"]
) {
  const utils = trpc.useContext();
  return trpc.reportsItems.delete.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.reportsItems.list.invalidate();

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
