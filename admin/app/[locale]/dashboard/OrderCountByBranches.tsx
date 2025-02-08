import React, { useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@admin/components/ui/card";
import {
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
  XAxis,
  YAxis,
  BarChart,
  Bar,
} from "recharts";
import { useSuspenseQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
  useQueryStates,
  parseAsIsoDateTime,
} from "nuqs";
import { organizations } from "@admin/lib/organizations";
import { DebugInfo } from "@admin/components/charts/DebugInfo";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { ArrowUp } from "lucide-react";
import { ArrowDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
const calculateNiceTicks = (min: number, max: number, targetTickCount = 7) => {
  const range = max - min;
  const roughStep = range / (targetTickCount - 1);

  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const niceFactor = roughStep / magnitude;

  let niceStep;
  if (niceFactor < 1.5) niceStep = magnitude;
  else if (niceFactor < 3) niceStep = 2 * magnitude;
  else if (niceFactor < 7) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  const ticks: number[] = [];
  let currentTick = Math.ceil(min / niceStep) * niceStep;

  while (currentTick <= max) {
    ticks.push(currentTick);
    currentTick += niceStep;
  }

  return ticks;
};

const fetchOrderCountByBranchesData = async (
  startDate: string,
  endDate: string,
  organization?: string,
  terminals?: string,
) => {
  if (!startDate || !endDate) {
    throw new Error("Date filter is mandatory");
  }

  let query: {
    startDate: string;
    endDate: string;
    organization?: string;
    terminals?: string;
  } = {
    startDate,
    endDate,
  };

  if (organization) {
    query.organization = organization;
  }
  if (terminals) {
    query.terminals = terminals;
  }

  const { data, status } = await apiClient.api.charts["order-count-by-branches"].get(
    {
      query
    }
  );

  if (status != 200) {
    let errorMessage = "Error fetching data";
    if (data && typeof data === "object" && "message" in data) {
      errorMessage = String(data.message);
    }
    throw new Error(errorMessage);
  }

  if (!data || !data.data || !Array.isArray(data.data)) {
    throw new Error("No data found or invalid data format");
  }

  return data;
};

interface BranchOrderCount {
  name: string;
  current_order_count: number;
  previous_order_count: number | null;
}

const OrderCountByBranches = () => {
  const t = useTranslations();
  const { dateRange } = useDateRangeState();
  const { startDate, endDate } = React.useMemo(() => {
    if (dateRange) {
      return {
        startDate: dateRange.from!,
        endDate: dateRange.to!,
      };
    }
    return { startDate: new Date(), endDate: new Date() };
  }, [dateRange]);
  const [terminals] = useTerminalsFilter();
  const [organization, setOrganization] = useState<string | null>(null);


  const { data } = useSuspenseQuery({
    queryKey: [
      "orderCountByBranches",
      startDate,
      endDate,
      organization,
      terminals,
    ],
    queryFn: () =>
      fetchOrderCountByBranchesData(
        startDate.toISOString(),
        endDate.toISOString(),
        organization ?? undefined,
        terminals ? terminals.toString() : undefined,
      ),
  });

  const sortedData = useMemo(() => {
    return [...data.data]
      .sort((a: BranchOrderCount, b: BranchOrderCount) =>
        b.current_order_count - a.current_order_count
      )
      .map((item, index) => ({
        ...item,
        name: `${index + 1}. ${item.name}`
      }));
  }, [data.data]);

  const xAxisTicks = useMemo(() => {
    if (!sortedData.length) return [0];

    const maxOrderCount = Math.max(
      ...sortedData.map(item => Math.max(
        item.current_order_count,
        item.previous_order_count || 0
      ))
    );
    const paddedMax = maxOrderCount * 1.15;
    return calculateNiceTicks(0, paddedMax);
  }, [sortedData]);

  const totalCurrentOrderCount = sortedData.reduce((acc, curr) => acc + curr.current_order_count, 0);
  const totalPreviousOrderCount = sortedData.reduce((acc, curr) => acc + (curr.previous_order_count || 0), 0);
  const difference = totalCurrentOrderCount - totalPreviousOrderCount;
  const percentChange = totalPreviousOrderCount !== 0 ? (totalCurrentOrderCount - totalPreviousOrderCount) / totalPreviousOrderCount : 0;
  const chartHeight = useMemo(() => {
    return Math.max(400, (sortedData.length * 35) + 100);
  }, [sortedData]);

  const formatCompactNumber = (number: number) => {
    const thousand = 1_000;
    const million = 1_000_000;

    if (Math.abs(number) >= million) {
      return `${(number / million).toFixed(1)} ${t('charts.million')}`;
    } else if (Math.abs(number) >= thousand) {
      return `${(number / thousand).toFixed(1)} ${t('charts.thousand')}`;
    }
    return number.toString();
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const currentOrderCount = payload[0].value;
      const previousOrderCount = payload[1]?.value || 0;
      const difference = currentOrderCount - previousOrderCount;
      const percentChange = previousOrderCount ? ((difference / previousOrderCount) * 100).toFixed(1) : 'N/A';

      return (
        <div className="bg-background p-4 border rounded-lg shadow-lg">
          <p className="font-bold">{label}</p>
          <p className="text-black dark:text-white">{t('charts.OrderCountByBranches.currentOrderCount')}: {new Intl.NumberFormat('ru-RU').format(currentOrderCount)}</p>
          <p className="text-black dark:text-white">{t('charts.OrderCountByBranches.previousOrderCount')}: {new Intl.NumberFormat('ru-RU').format(previousOrderCount)}</p>
          <p className={`font-semibold ${difference >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {t('charts.OrderCountByBranches.difference')}: {new Intl.NumberFormat('ru-RU').format(difference)}
            {percentChange !== 'N/A' ? ` (${difference >= 0 ? '+' : ''}${percentChange}%)` : ''}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="w-full h-full">
      <Card className="h-full flex flex-col">
        <CardHeader className="flex flex-col items-stretch space-y-0 border-b p-0 mb-2 sm:flex-row">
          <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
            <CardTitle>{t('charts.OrderCountByBranches.title')}</CardTitle>
            <div className="text-sm text-muted-foreground">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  {t('charts.OrderCountByBranches.currentOrderCount')}:
                  <div className="font-bold">
                    {totalCurrentOrderCount.toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {t('charts.OrderCountByBranches.previousOrderCount')}:
                  <div className="font-bold">
                    {totalPreviousOrderCount.toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {t('charts.OrderCountByBranches.difference')}:
                  <div className="font-bold flex items-center gap-1">
                    {difference.toLocaleString()}
                    <span
                      className={`text-sm flex items-center font-bold ${percentChange >= 0 ? "text-[#34d399]" : "text-[#ef4444]"
                        }`}
                    >
                      {percentChange >= 0 ? (
                        <ArrowUp className="h-4" />
                      ) : (
                        <ArrowDown className="h-4" />
                      )}
                      {(percentChange * 100).toFixed(2)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          {!terminals && (
            <div className="flex">
              <button
                data-active={!organization || organization.length == 0}
                className="relative z-30 flex flex-1 flex-col justify-center gap-1 border-t p-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0"
                onClick={() => setOrganization("")}
              >
                <span className="text-lg font-bold leading-none">{t('charts.all')}</span>
              </button>
              {organizations.map((org) => (
                <button
                  key={org.id}
                  data-active={organization === org.id}
                  className="relative z-30 flex flex-1 flex-col justify-center gap-1 border-t p-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0"
                  onClick={() => setOrganization(org.id)}
                >
                  <span className="text-lg font-bold leading-none">
                    {org.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-2 pt-0 flex-grow flex flex-col overflow-hidden">
          <div className="flex-grow min-h-0 overflow-auto">
            <div style={{ height: chartHeight }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={sortedData}
                  margin={{ top: 20, right: 30, left: 0, bottom: 100 }}
                  barSize={20}
                  barCategoryGap={4}
                  layout="vertical"
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    tickFormatter={formatCompactNumber}
                    domain={[0, (dataMax: number) => dataMax * 1.15]}
                    ticks={xAxisTicks}
                    minTickGap={2}
                    orientation="top"
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={200}
                    interval={0}
                    orientation="right"
                  />
                  <Tooltip
                    formatter={(value) => new Intl.NumberFormat('ru-RU').format(Number(value))}
                    labelStyle={{ color: 'black' }}
                    contentStyle={{ backgroundColor: 'white' }}
                    content={<CustomTooltip currentTitle={t('charts.OrderCountByBranches.currentOrderCount')} previousTitle={t('charts.OrderCountByBranches.previousOrderCount')} />}
                  />
                  <Legend verticalAlign="top" />
                  <Bar
                    dataKey="current_order_count"
                    name={t('charts.OrderCountByBranches.currentOrderCount')}
                    fill="green"
                  />
                  <Bar
                    dataKey="previous_order_count"
                    name={t('charts.OrderCountByBranches.previousOrderCount')}
                    fill="gray"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
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

export default OrderCountByBranches;
