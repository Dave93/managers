"use client";

import React from "react";
import { MobileReportCards } from "./MobileReportCards";

// Auto-renders a mobile card list from any tanstack ColumnDef[] + rows.
// Picks the first column with a string header & accessorKey as `primary`,
// the second as `secondary`, the rest (up to 6) as label/value field rows.
// Cell renderers are invoked with a minimal context so most custom formatters work.

type AutoProps = {
  rows: any[];
  columns: any[];
  isLoading?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  canPrev?: boolean;
  canNext?: boolean;
  page?: number;
  empty?: React.ReactNode;
};

function getAccessor(col: any): string | undefined {
  return col?.accessorKey || col?.id;
}

function getLabel(col: any): React.ReactNode {
  const h = col?.header;
  if (typeof h === "string") return h;
  return col?.id || col?.accessorKey || "";
}

function getValue(col: any, row: any): React.ReactNode {
  const key = getAccessor(col);
  const raw = key ? row?.[key] : undefined;
  if (typeof col?.cell === "function") {
    try {
      const ctx: any = {
        row: {
          original: row,
          getValue: (k: string) => row?.[k],
        },
        getValue: () => raw,
        column: col,
      };
      const out = col.cell(ctx);
      if (out !== undefined && out !== null) return out;
    } catch {
      // fall through to raw
    }
  }
  return raw == null || raw === "" ? "—" : String(raw);
}

export function AutoMobileCards({ rows, columns, isLoading, onPrev, onNext, canPrev, canNext, page, empty }: AutoProps) {
  const usable = React.useMemo(
    () =>
      columns.filter((c: any) => {
        const k = getAccessor(c);
        // skip pure-icon columns where header is empty and there is no accessorKey
        if (!k) return false;
        // skip the expand/id chevron column from desktop
        if (k === "id" && (typeof c?.header !== "string" || c.header === "")) return false;
        return true;
      }),
    [columns]
  );

  return (
    <MobileReportCards
      rows={rows}
      isLoading={isLoading}
      empty={empty}
      onPrev={onPrev}
      onNext={onNext}
      canPrev={canPrev}
      canNext={canNext}
      page={page}
      render={(r) => {
        const [primaryCol, secondaryCol, ...restCols] = usable;
        return {
          primary: primaryCol ? getValue(primaryCol, r) : "—",
          secondary: secondaryCol ? getValue(secondaryCol, r) : "",
          fields: restCols.slice(0, 6).map((c) => ({
            label: getLabel(c),
            value: getValue(c, r),
          })),
        };
      }}
    />
  );
}

export default AutoMobileCards;
