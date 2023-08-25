import { trpc, ReactQueryOptions, RouterInputs } from "@admin/utils/trpc";

export function useCredentialsQuery(
  filter: RouterInputs["credentials"]["list"]
) {
  return trpc.credentials.list.useQuery(filter);
}

export function useCredentialsCreate(
  options: ReactQueryOptions["credentials"]["add"]
) {
  const utils = trpc.useContext();
  return trpc.credentials.add.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.credentials.list.invalidate();

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

export function useCredentialsUpdate(
  options: ReactQueryOptions["credentials"]["renew"]
) {
  const utils = trpc.useContext();
  return trpc.credentials.renew.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.credentials.list.invalidate();

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

export function useCredentialsDestroy(
  options: ReactQueryOptions["credentials"]["delete"]
) {
  const utils = trpc.useContext();
  return trpc.credentials.delete.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.credentials.list.invalidate();

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
