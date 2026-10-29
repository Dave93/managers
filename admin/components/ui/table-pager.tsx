"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
} from "@radix-ui/react-icons";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@admin/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { cn } from "@admin/lib/utils";

type Props = {
  /** Текущая страница, с нуля. */
  pageIndex: number;
  /** Всего страниц; если число записей неизвестно — 0 или меньше. */
  pageCount: number;
  pageSize: number;
  /** Всего записей — для подписи «51–100 из 340». */
  total?: number | null;
  sizes?: number[];
  onPageChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  className?: string;
};

// 1 … 4 5 [6] 7 8 … 20: первая, последняя и соседи текущей, остальное — «…».
export function pageItems(current: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i);
  const set = new Set<number>([0, count - 1, current - 1, current, current + 1]);
  if (current <= 2) [1, 2, 3].forEach((n) => set.add(n));
  if (current >= count - 3) [count - 2, count - 3, count - 4].forEach((n) => set.add(n));
  const sorted = [...set].filter((n) => n >= 0 && n < count).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) out.push("gap");
    out.push(n);
  });
  return out;
}

export function TablePager({
  pageIndex,
  pageCount,
  pageSize,
  total,
  sizes = [10, 20, 50, 100],
  onPageChange,
  onPageSizeChange,
  className,
}: Props) {
  const t = useTranslations("common.pager");
  const count = Math.max(pageCount, 1);
  const [jump, setJump] = useState("");
  useEffect(() => setJump(""), [pageIndex, pageSize]);

  const go = (i: number) => onPageChange(Math.min(Math.max(i, 0), count - 1));
  const submitJump = () => {
    const n = Number(jump);
    if (Number.isInteger(n) && n >= 1) go(n - 1);
    setJump("");
  };

  const hasTotal = typeof total === "number" && total > 0;
  const from = hasTotal ? pageIndex * pageSize + 1 : 0;
  const to = hasTotal ? Math.min((pageIndex + 1) * pageSize, total as number) : 0;
  const atStart = pageIndex <= 0;
  const atEnd = pageIndex >= count - 1;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-2 text-sm",
        className,
      )}
    >
      <div className="whitespace-nowrap text-muted-foreground">
        {hasTotal ? t("range", { from, to, total: total as number }) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap font-medium">{t("rowsPerPage")}</span>
          <Select value={`${pageSize}`} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger className="h-8 w-[72px]">
              <SelectValue placeholder={pageSize} />
            </SelectTrigger>
            <SelectContent side="top">
              {sizes.map((s) => (
                <SelectItem key={s} value={`${s}`}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <nav className="flex items-center gap-1" aria-label={t("nav")}>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => go(0)}
            disabled={atStart}
            title={t("first")}
          >
            <span className="sr-only">{t("first")}</span>
            <DoubleArrowLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => go(pageIndex - 1)}
            disabled={atStart}
            title={t("prev")}
          >
            <span className="sr-only">{t("prev")}</span>
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>

          {/* На узком экране — «2 / 20», на широком — номера страниц. */}
          <span className="whitespace-nowrap px-2 font-medium tabular-nums sm:hidden">
            {t("compact", { page: pageIndex + 1, count })}
          </span>
          <div className="hidden items-center gap-1 sm:flex">
            {pageItems(pageIndex, count).map((it, i) =>
              it === "gap" ? (
                <span key={`gap-${i}`} className="px-1 text-muted-foreground" aria-hidden>
                  …
                </span>
              ) : (
                <Button
                  key={it}
                  variant={it === pageIndex ? "default" : "outline"}
                  className="h-8 min-w-8 px-2 tabular-nums"
                  onClick={() => go(it)}
                  aria-current={it === pageIndex ? "page" : undefined}
                  title={t("pageN", { page: it + 1 })}
                >
                  {it + 1}
                </Button>
              ),
            )}
          </div>

          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => go(pageIndex + 1)}
            disabled={atEnd}
            title={t("next")}
          >
            <span className="sr-only">{t("next")}</span>
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-8 w-8 p-0"
            onClick={() => go(count - 1)}
            disabled={atEnd}
            title={t("last")}
          >
            <span className="sr-only">{t("last")}</span>
            <DoubleArrowRightIcon className="h-4 w-4" />
          </Button>
        </nav>

        {count > 7 && (
          <label className="flex items-center gap-2">
            <span className="whitespace-nowrap font-medium">{t("goTo")}</span>
            <Input
              type="number"
              min={1}
              max={count}
              value={jump}
              placeholder={`${pageIndex + 1}`}
              onChange={(e) => setJump(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitJump();
              }}
              onBlur={() => jump && submitJump()}
              className="h-8 w-16 px-2 tabular-nums"
            />
          </label>
        )}
      </div>
    </div>
  );
}
