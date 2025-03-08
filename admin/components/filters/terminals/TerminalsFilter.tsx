"use client";
import { Check, ChevronsUpDown, X } from "lucide-react";

import { cn } from "@admin/lib/utils";
import { Button } from "@admin/components/ui/buttonOrigin";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@admin/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@admin/components/ui/popover";
import { useQuery } from "@tanstack/react-query";
import useToken from "@admin/store/get-token";
import { apiClient } from "@admin/utils/eden";
import { useState, useMemo, useCallback } from "react";
import { PaginationState } from "@tanstack/react-table";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";

export default function TerminalsFilter() {
  const [{ pageIndex, pageSize }, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });
  const [selectedTerminal, setSelectedTerminal] = useTerminalsFilter();
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: [
      "filter_terminals"
    ],
    queryFn: async () => {
      const { data } = await apiClient.api.terminals.my_terminals.get();
      return data;
    },
  });

  const [open, setOpen] = useState(false);

  const terminals = useMemo(() => data?.data || [], [data]);

  const filteredTerminals = useMemo(() => {
    return terminals.filter((terminal) =>
      terminal.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [terminals, searchQuery]);

  const handleSearch = useCallback((value: string) => {
    setSearchQuery(value);
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="border flex items-center justify-between px-3 relative rounded-md w-[300px]">
        {selectedTerminal
          ? terminals.find((t) => t.id === selectedTerminal)?.name
          : "Все терминалы"}
        <div className="flex items-center">
          {selectedTerminal && (
            <X
              className="h-4 w-4 mr-2 cursor-pointer"
              onClick={(e) => {
                e.stopPropagation();
                if (typeof setSelectedTerminal === 'function') {
                  setSelectedTerminal(null);
                }
              }}
            />
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search terminals..."
            value={searchQuery}
            onValueChange={handleSearch}
          />
          <CommandList>
            {filteredTerminals.length === 0 ? (
              <CommandEmpty>No terminal found.</CommandEmpty>
            ) : (
              <CommandGroup>
                {filteredTerminals.map((terminal) => (
                  <CommandItem
                    key={terminal.id}
                    value={terminal.id}
                    onSelect={(value) => {
                      if (typeof setSelectedTerminal === 'function') {
                        setSelectedTerminal(value === selectedTerminal ? null : value);
                      }
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        selectedTerminal === terminal.id ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {terminal.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
