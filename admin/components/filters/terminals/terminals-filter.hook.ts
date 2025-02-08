import { parseAsString, useQueryState } from "nuqs";

export function useTerminalsFilter() {
    const [selectedTerminal, setSelectedTerminal] = useQueryState("terminals", parseAsString);
    return [selectedTerminal, setSelectedTerminal];
}