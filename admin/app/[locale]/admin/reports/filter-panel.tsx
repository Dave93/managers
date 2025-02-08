"use client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@admin/components/ui/card";
import TerminalsFilter from "@admin/components/filters/terminals/TerminalsFilter";
import { DateRangeFilter } from "@admin/components/filters/date-range-filter/date-range-filter";
import { useTranslations } from "next-intl";
import ReportsStatusesFilter from "@admin/components/filters/reports-statuses/ReportsStatusesFilter";

const ReportsFilterPanel = () => {
  const t = useTranslations("charts.filters");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="flex space-x-4">
        <DateRangeFilter />
        <TerminalsFilter />
        <ReportsStatusesFilter />
      </CardContent>
    </Card>
  );
};

export default ReportsFilterPanel;
