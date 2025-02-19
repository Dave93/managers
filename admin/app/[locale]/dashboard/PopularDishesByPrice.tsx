import { DebugInfo } from "@admin/components/charts/DebugInfo";
import { Card, CardContent, CardHeader, CardTitle } from "@admin/components/ui/card";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { apiClient } from "@admin/utils/eden";
import { useSuspenseQuery } from "@tanstack/react-query";
import { parseAsIsoDateTime, parseAsString, useQueryState, useQueryStates } from "nuqs";
import React from "react";
import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useTranslations } from "next-intl";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";

const fetchPopularDishesData = async (
  startDate: string,
  endDate: string,
  interval: string,
  terminals?: string,
  organizationId?: string
) => {
  if (!startDate || !endDate) {
    throw new Error("Date filter is mandatory");
  }

  let query: {
    startDate: string;
    endDate: string;
    interval: string;
    terminals?: string | undefined;
    organizationId?: string;
  } = {
    startDate,
    endDate,
    interval,
  };

  if (terminals) {
    query = {
      ...query,
      terminals,
    };
  }

  if (organizationId) {
    query = {
      ...query,
      organizationId,
    };
  }

  const { data, error, status } = await apiClient.api.charts["popular-dishes-by-price"].get({
    query
  });

  if (status != 200) {
    let errorMessage = "Error fetching data";
    if (data && typeof data === "object" && "message" in data) {
      errorMessage = String(data.message);
    }
    throw new Error(errorMessage);
  }

  if (!data || !Array.isArray(data.data)) {
    throw new Error("No data found or invalid data format");
  }

  return data;
};


const PopularDishesChart = () => {
  const t = useTranslations();
  const [terminals] = useTerminalsFilter();
  const [organization, setOrganization] = useState<string | null>(null);
  const [interval, setInterval] = React.useState("1 day");

  const { dateRange } = useDateRangeState();
  const { startDate, endDate } = React.useMemo(() => {
    if (dateRange) {
      return { startDate: dateRange.from!, endDate: dateRange.to! };
    }
    return { startDate: new Date(), endDate: new Date() };
  }, [dateRange]);

  const { data } = useSuspenseQuery({
    queryKey: [
      "popularDishesByPrice",
      startDate,
      endDate,
      interval,
      terminals,
      organization,
    ],
    queryFn: () =>
      fetchPopularDishesData(
        startDate.toISOString(),
        endDate.toISOString(),
        interval,
        terminals ? terminals.toString() : undefined,
        organization ?? undefined
      ),
  });

  // Sort the data by value (sales) in descending order and take the top 10
  const topDishes = data.data?.sort((a, b) => b.value - a.value).slice(0, 10);
  const currencyFormat = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'UZS', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const formatCompactNumber = (number: number) => {
    const billion = 1_000_000_000;
    const million = 1_000_000;
    const thousand = 1_000;

    if (Math.abs(number) >= billion) {
      return `${(number / billion).toFixed(0)} ${t('charts.billion')} `;
    } else if (Math.abs(number) >= million) {
      return `${(number / million).toFixed(0)} ${t('charts.million')} `;
    } else if (Math.abs(number) >= thousand) {
      return `${(number / thousand).toFixed(0)} ${t('charts.thousand')} `;
    }
    return number.toString();
  };

  return (
    <div className="w-full h-[400px]">
      <Card className="h-full flex flex-col">
        <CardHeader className="pb-0">
          <CardTitle>{t('charts.PopularDishesByPrice.title')}</CardTitle>
        </CardHeader>
        <CardContent className="p-2 flex-grow flex flex-col">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={topDishes}
              layout="vertical"
              margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
              barSize={5}

            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" tickFormatter={(value) => formatCompactNumber(Number(value))} />
              <YAxis
                dataKey="name"
                type="category"
                width={150}
                minTickGap={2}
                tickFormatter={(value) => {
                  return value.length > 12 ? value.substring(0, 12) + '...' : value;
                }}
              />
              <Tooltip labelStyle={{ color: 'black' }} contentStyle={{ backgroundColor: 'white' }} formatter={(value) => currencyFormat.format(Number(value))} />
              <Legend />
              <Bar dataKey="value" fill="#8884d8" name={t('charts.PopularDishesByPrice.salesAmount')} />
            </BarChart>
          </ResponsiveContainer>
          {data && 'debug' in data && data.debug && (
            <div className="flex justify-end">
              <DebugInfo sqlQueryTime={data.debug.sqlQueryTime} apiTime={data.debug.apiTime} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PopularDishesChart;
