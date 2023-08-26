import { trpc, ReactQueryOptions, RouterInputs } from "@admin/utils/trpc";

export function useSettingsQuery(filter: RouterInputs["settings"]["list"]) {
  return trpc.settings.list.useQuery(filter);
}

export function useSettingsCreate(
  options: ReactQueryOptions["settings"]["add"]
) {
  const utils = trpc.useContext();
  return trpc.settings.add.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.settings.list.invalidate();

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

export function useSettingsUpdate(
  options: ReactQueryOptions["settings"]["renew"]
) {
  const utils = trpc.useContext();
  return trpc.settings.renew.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.settings.list.invalidate();

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

export function useSettingsDestroy(
  options: ReactQueryOptions["settings"]["delete"]
) {
  const utils = trpc.useContext();
  return trpc.settings.delete.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.settings.list.invalidate();

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

export function useSettingsSet(options: ReactQueryOptions["settings"]["set"]) {
  const utils = trpc.useContext();
  return trpc.settings.set.useMutation({
    ...options,
    onSuccess: (post) => {
      utils.settings.list.invalidate();

      options?.onSuccess?.(
        post,
        {
          where: {
            id: post.id,
          },
          update: post,
          create: post,
        },
        {}
      );
    },
  });
}
