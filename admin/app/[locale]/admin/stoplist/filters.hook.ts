import { parseAsString, parseAsStringEnum, useQueryState } from "nuqs";

export const STOPLIST_BRANDS = ["les", "chopar"] as const;
export const STOPLIST_STATUSES = ["all", "open", "closed"] as const;

export function useStoplistBrandFilter() {
  return useQueryState("brand", parseAsStringEnum([...STOPLIST_BRANDS]));
}

export function useStoplistStatusFilter() {
  return useQueryState(
    "status",
    parseAsStringEnum([...STOPLIST_STATUSES]).withDefault("all")
  );
}

export function useStoplistSearchFilter() {
  return useQueryState("q", parseAsString.withDefault(""));
}
