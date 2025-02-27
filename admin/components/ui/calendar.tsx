"use client"

import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { DayPicker } from "react-day-picker"

import { cn } from "@admin/lib/utils"
import { buttonVariants } from "@components/ui/button"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      captionLayout="dropdown"
      showOutsideDays={showOutsideDays}
      className={cn(
        "p-4 rounded-xl shadow-md text-white",

      )}
      components={{
        Chevron: (props) => {
          if (props.orientation === "left") {
            return <ChevronLeftIcon className="h-5 w-5 border rounded-sm text-blue-400" />;
          }
          return <ChevronRightIcon className="h-5 w-5 border rounded-sm text-blue-400" />;
        },
      }}
      classNames={{

        month: "space-y-4",
        caption: "flex items-center justify-between",
        caption_label: "hidden",
        nav: "space-x-2 flex justify-between pb-2",
        nav_button: cn(
          buttonVariants({ variant: "outline" }),
          "h-6 w-6 p-0 text-blue-400 hover:text-blue-300 bg-transparent border-none"
        ),
        nav_button_previous: "order-1",
        nav_button_next: "order-2",
        table: "w-full border-collapse mt-2",
        head_row: "flex justify-between",
        head_cell: "text-xs font-medium text-gray-400 uppercase w-10 h-10 flex items-center justify-center",
        row: "flex w-full mt-1 justify-between",
        cell: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20 [&:has([aria-selected])]:bg-accent [&:has([aria-selected].day-outside)]:bg-accent/50 [&:has([aria-selected].day-range-end)]:rounded-r-md",
          props.mode === "range"
            ? "[&:has(>.day-range-end)]:rounded-r-md [&:has(>.day-range-start)]:rounded-l-md first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md"
            : "[&:has([aria-selected])]:rounded-md"
        ),
        day: "hover:bg-accent hover:text-accent-foreground text-center",
        day_selected: "bg-blue-500 text-white rounded-full font-medium",
        day_today: "border border-blue-400 rounded-full",
        day_outside: "text-gray-200",
        day_disabled: "text-gray-700 opacity-50",
        day_hidden: "invisible",
        ...classNames,
      }}
      {...props}
    />
  )
}
Calendar.displayName = "Calendar"

export { Calendar }