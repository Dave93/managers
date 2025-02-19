import { parseAsString, useQueryState } from "nuqs";

export function useReportsStatusesFilter() {
    return useQueryState("status", parseAsString);
}