"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from "lucide-react";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Card, CardHeader, CardTitle, CardDescription } from "@admin/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@components/ui/table";
import { cn } from "@admin/lib/utils";
import {
  getStatement,
  statementExportUrl,
  type CreditEntryType,
} from "@admin/lib/credit-api";
import { useFormatSum } from "../columns";

const ENTRY_TYPES: CreditEntryType[] = [
  "authorize",
  "capture",
  "void",
  "refund",
  "amend",
  "payment",
  "adjustment",
];

const PAGE_SIZE = 50;

export default function StatementTab({ companyId }: { companyId: string }) {
  const t = useTranslations("systemPages.creditCompanies.statement");
  const tc = useTranslations("forms.common");
  const formatSum = useFormatSum();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [brand, setBrand] = useState<string>("all");
  const [offset, setOffset] = useState(0);

  const query = {
    from: from || undefined,
    to: to || undefined,
    brand: brand === "all" ? undefined : brand,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["credit_statement", companyId, { ...query, limit: PAGE_SIZE, offset }],
    queryFn: async () => {
      const { data } = await getStatement(companyId, {
        ...query,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      return data;
    },
  });

  const summary = data?.summary;
  const entries = data?.data ?? [];
  const total = data?.total ?? 0;

  const resetAndRefetch = () => setOffset(0);

  return (
    <div className="space-y-4 py-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader>
            <CardDescription>{t("debt")}</CardDescription>
            <CardTitle>{formatSum(summary?.posted)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t("reserved")}</CardDescription>
            <CardTitle>{formatSum(summary?.reserved)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t("available")}</CardDescription>
            <CardTitle>{formatSum(summary?.available)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t("day")}</CardDescription>
            <CardTitle className="text-base">
              {formatSum(summary?.day_spent)} / {formatSum(summary?.limit_daily)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t("month")}</CardDescription>
            <CardTitle className="text-base">
              {formatSum(summary?.month_spent)} / {formatSum(summary?.limit_monthly)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="space-y-1">
          <Label>{t("fromDate")}</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              resetAndRefetch();
            }}
          />
        </div>
        <div className="space-y-1">
          <Label>{t("toDate")}</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              resetAndRefetch();
            }}
          />
        </div>
        <div className="space-y-1">
          <Label>{t("brand")}</Label>
          <Select
            value={brand}
            onValueChange={(v) => {
              setBrand(v);
              resetAndRefetch();
            }}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("all")}</SelectItem>
              <SelectItem value="chopar">Chopar</SelectItem>
              <SelectItem value="les">Les Ailes</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          variant="outline"
          onClick={() => window.open(statementExportUrl(companyId, query), "_blank")}
        >
          <DownloadIcon className="mr-2 h-4 w-4" /> {t("exportXlsx")}
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("date")}</TableHead>
              <TableHead>{tc("type")}</TableHead>
              <TableHead>{t("brand")}</TableHead>
              <TableHead>{t("orderNumber")}</TableHead>
              <TableHead className="text-right">{t("amount")}</TableHead>
              <TableHead className="text-right">{t("balance")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-16 text-center text-muted-foreground">
                  {tc("loading")}
                </TableCell>
              </TableRow>
            ) : entries.length ? (
              entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{new Date(entry.created_at).toLocaleString("ru-RU")}</TableCell>
                  <TableCell>{ENTRY_TYPES.includes(entry.entry_type) ? t(`entryTypes.${entry.entry_type}`) : entry.entry_type}</TableCell>
                  <TableCell>{entry.brand ?? "—"}</TableCell>
                  <TableCell>{entry.order_number ?? "—"}</TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-medium",
                      entry.amount < 0 && "text-green-600"
                    )}
                  >
                    {formatSum(entry.amount)}
                  </TableCell>
                  <TableCell className="text-right">{formatSum(entry.balance_after)}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-16 text-center text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between px-2">
        <div className="text-sm text-muted-foreground">
          {t("total", { count: String(total) })}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            disabled={offset === 0}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
          >
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
