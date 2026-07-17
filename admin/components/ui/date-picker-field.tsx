"use client";
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import { CalendarIcon } from "@radix-ui/react-icons";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Calendar } from "@admin/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@admin/components/ui/popover";
import { cn } from "@admin/lib/utils";

// Single-date picker bound to an ISO yyyy-MM-dd string ("" = empty).
export function DatePickerField({
  value,
  onChange,
  maxToday = false,
  placeholder = "дд.мм.гггг",
  className,
}: {
  value: string;
  onChange: (iso: string) => void;
  maxToday?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "w-full justify-start text-left font-normal",
            !value && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {selected ? format(selected, "dd.MM.yyyy") : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 z-[60]" align="start">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          disabled={maxToday ? { after: new Date() } : undefined}
          locale={ru}
          onSelect={(d) => {
            onChange(d ? format(d, "yyyy-MM-dd") : "");
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
