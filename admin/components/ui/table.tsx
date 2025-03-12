/// <reference lib="dom" />
import * as React from "react";

import { cn } from "@admin/lib/utils";

const Table = (
  {
    ref,
    className,
    wrapperClassName,
    ...props
  }
) => wrapperClassName ? (
  <div className={cn("w-full overflow-auto", wrapperClassName)}>
    <table
      ref={ref}
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  </div>
) : (
  <table
    ref={ref}
    className={cn("w-full caption-bottom text-sm", className)}
    {...props}
  />
);
Table.displayName = "Table";

const TableHeader = (
  {
    ref,
    className,
    ...props
  }: React.HTMLAttributes<HTMLTableSectionElement> & {
    ref: React.RefObject<HTMLTableSectionElement>;
  }
) => (<thead ref={ref} className={cn("[&_tr]:border-b", className)} {...props} />);
TableHeader.displayName = "TableHeader";

const TableBody = (
  {
    ref,
    className,
    ...props
  }: React.HTMLAttributes<HTMLTableSectionElement> & {
    ref: React.RefObject<HTMLTableSectionElement>;
  }
) => (<tbody
  ref={ref}
  className={cn("[&_tr:last-child]:border-0", className)}
  {...props}
/>);
TableBody.displayName = "TableBody";

const TableFooter = (
  {
    ref,
    className,
    ...props
  }: React.HTMLAttributes<HTMLTableSectionElement> & {
    ref: React.RefObject<HTMLTableSectionElement>;
  }
) => (<tfoot
  ref={ref}
  className={cn("bg-primary font-medium text-primary-foreground", className)}
  {...props}
/>);
TableFooter.displayName = "TableFooter";

const TableRow = (
  {
    ref,
    className,
    ...props
  }: React.HTMLAttributes<HTMLTableRowElement> & {
    ref: React.RefObject<HTMLTableRowElement>;
  }
) => (<tr
  ref={ref}
  className={cn(
    "border-b transition-colors data-[state=selected]:bg-muted text-[9px] sm:text-sm group",
    className
  )}
  {...props}
/>);
TableRow.displayName = "TableRow";

const TableHead = (
  {
    ref,
    className,
    ...props
  }: React.ThHTMLAttributes<HTMLTableCellElement> & {
    ref: React.RefObject<HTMLTableCellElement>;
  }
) => (<th
  ref={ref}
  className={cn(
    "h-12 px-2 text-left align-middle text-muted-foreground [&:has([role=checkbox])]:pr-0 border-2 font-bold bg-gray-200 dark:bg-gray-300 text-black border-black",
    className
  )}
  colSpan={props.colSpan}
  {...props}
/>);
TableHead.displayName = "TableHead";

const TableCell = (
  {
    ref,
    className,
    ...props
  }: React.TdHTMLAttributes<HTMLTableCellElement> & {
    ref: React.RefObject<HTMLTableCellElement>;
  }
) => (<td
  ref={ref}
  className={cn(
    "px-2 py-1 align-middle [&:has([role=checkbox])]:pr-0 border-2 border-black group-odd:bg-gray-200 dark:group-odd:text-black dark:group-odd:bg-gray-300 dark:group-even:bg-gray-100 font-bold dark:group-even:text-black",
    className
  )}
  {...props}
/>);
TableCell.displayName = "TableCell";

const TableCaption = (
  {
    ref,
    className,
    ...props
  }: React.HTMLAttributes<HTMLTableCaptionElement> & {
    ref: React.RefObject<HTMLTableCaptionElement>;
  }
) => (<caption
  ref={ref}
  className={cn("mt-4 text-sm text-muted-foreground", className)}
  {...props}
/>);
TableCaption.displayName = "TableCaption";

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
};
