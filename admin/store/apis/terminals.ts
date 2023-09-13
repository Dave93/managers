import { trpc, ReactQueryOptions } from "@admin/utils/trpc";

export function useTerminalsQuery(filter: any) {
  return trpc.terminals.list.useQuery(filter);
}
