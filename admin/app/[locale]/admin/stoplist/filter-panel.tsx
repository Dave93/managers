"use client";
import { Card, CardContent, CardHeader, CardTitle } from "@admin/components/ui/card";
import { Input } from "@admin/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui/select";
import TerminalsFilter from "@admin/components/filters/terminals/TerminalsFilter";
import { DateRangeFilter } from "@admin/components/filters/date-range-filter/date-range-filter";
import { useTranslations } from "next-intl";
import {
  useStoplistBrandFilter,
  useStoplistSearchFilter,
  useStoplistStatusFilter,
} from "./filters.hook";

const ALL = "__all__";

const StoplistFilterPanel = () => {
  const t = useTranslations("charts.filters");
  const [brand, setBrand] = useStoplistBrandFilter();
  const [status, setStatus] = useStoplistStatusFilter();
  const [search, setSearch] = useStoplistSearchFilter();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-4">
        <DateRangeFilter />
        <TerminalsFilter />
        <Select
          value={brand ?? ALL}
          onValueChange={(v) => setBrand(v === ALL ? null : (v as "les" | "chopar"))}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Бренд" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Все бренды</SelectItem>
            <SelectItem value="les">Les Ailes</SelectItem>
            <SelectItem value="chopar">Chopar</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="open">Сейчас в стопе</SelectItem>
            <SelectItem value="closed">Снятые</SelectItem>
          </SelectContent>
        </Select>
        <Input
          className="w-[240px]"
          placeholder="Поиск по продукту или филиалу"
          value={search}
          onChange={(e) => setSearch(e.target.value || null)}
        />
      </CardContent>
    </Card>
  );
};

export default StoplistFilterPanel;
