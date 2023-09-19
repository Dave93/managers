import { trpc, ReactQueryOptions, RouterInputs } from "@admin/utils/trpc";

export function useReportsQuery(filter: any) {
  return trpc.reports.list.useQuery(filter);
}

export function useReportsByMonthQuery(
  filter: RouterInputs["reports"]["listByDate"]
) {
  return trpc.reports.listByDate.useQuery(filter);
}

export function useReportsCreate(options: ReactQueryOptions["reports"]["add"]) {
  const utils = trpc.useContext();
  return trpc.reports.add.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.reports.list.invalidate();

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

export function useReportsUpdate(
  options: ReactQueryOptions["reports"]["renew"]
) {
  const utils = trpc.useContext();
  return trpc.reports.renew.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.reports.list.invalidate();

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

export function useReportsDestroy(
  options: ReactQueryOptions["reports"]["delete"]
) {
  const utils = trpc.useContext();
  return trpc.reports.delete.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.reports.list.invalidate();

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
