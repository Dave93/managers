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
  Cell,
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
import { ArrowUp } from "lucide-react";
import { ArrowDown } from "lucide-react";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { organizations } from "@admin/lib/organizations";
import { DebugInfo } from "@admin/components/charts/DebugInfo";
import { useTranslations } from "next-intl";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";


const calculateNiceTicks = (min: number, max: number, targetTickCount = 7) => {
  const range = max - min;
  const roughStep = range / (targetTickCount - 1);

  // Round to a nice number
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const niceFactor = roughStep / magnitude;

  let niceStep;
  if (niceFactor < 1.5) niceStep = magnitude;
  else if (niceFactor < 3) niceStep = 2 * magnitude;
  else if (niceFactor < 7) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  // Generate ticks
  const ticks: number[] = [];
  let currentTick = Math.ceil(min / niceStep) * niceStep;

  while (currentTick <= max) {
    ticks.push(currentTick);
    currentTick += niceStep;
  }

  return ticks;
};

const fetchRevenueByBranchesData = async (
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

  const { data, status } = await apiClient.api.charts["revenue-by-branches"].get(
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

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];

// Update the interface for type safety
interface BranchRevenue {
  name: string;
  current_revenue: number;
  previous_revenue: number | null;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  currentTitle: string;
  previousTitle: string;
}

const CustomTooltip = ({ active, payload, label, currentTitle, previousTitle }: CustomTooltipProps) => {
  const t = useTranslations("charts");

  if (active && payload && payload.length) {
    const currentRevenue = payload[0].value;
    const previousRevenue = payload[1]?.value || 0;
    const difference = currentRevenue - previousRevenue;
    const percentChange = previousRevenue ? ((difference / previousRevenue) * 100).toFixed(1) : 'N/A';

    return (
      <div className="bg-background p-4 border rounded-lg shadow-lg">
        <p className="font-bold">{label}</p>
        <p className="text-black dark:text-white">{currentTitle}: {new Intl.NumberFormat('ru-RU').format(currentRevenue)}</p>
        <p className="text-black dark:text-white">{previousTitle}: {new Intl.NumberFormat('ru-RU').format(previousRevenue)}</p>
        <p className={`font-semibold ${difference >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {t('RevenueByBranches.difference')}: {new Intl.NumberFormat('ru-RU').format(difference)}
          {percentChange !== 'N/A' ? ` (${difference >= 0 ? '+' : ''}${percentChange}%)` : ''}
        </p>
      </div>
    );
  }
  return null;
};

const RevenueByBranches = () => {
  const t = useTranslations("charts");
  const now = new Date();
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
      "revenueByBranches",
      startDate,
      endDate,
      organization,
      terminals
    ],
    queryFn: () =>
      fetchRevenueByBranchesData(
        startDate.toISOString(),
        endDate.toISOString(),
        organization ?? undefined,
        terminals ? terminals.toString() : undefined,
      ),
  });
  const sortedData = useMemo(() => {
    return [...data.data]
      .sort((a: BranchRevenue, b: BranchRevenue) =>
        b.current_revenue - a.current_revenue
      )
      .map((item, index) => ({
        ...item,
        name: `${index + 1} - ${item.name}`
      }));
  }, [data.data]);
  const xAxisTicks = useMemo(() => {
    if (!sortedData.length) return [0];

    const maxRevenue = Math.max(
      ...sortedData.map(item => Math.max(
        item.current_revenue,
        item.previous_revenue || 0
      ))
    );
    const paddedMax = maxRevenue * 1.15;
    return calculateNiceTicks(0, paddedMax);
  }, [sortedData]);
  const totalCurrentRevenue = sortedData.reduce((acc, curr) => acc + curr.current_revenue, 0);
  const totalPreviousRevenue = sortedData.reduce((acc, curr) => acc + (curr.previous_revenue || 0), 0);
  const percentChange = totalPreviousRevenue !== 0 ? (totalCurrentRevenue - totalPreviousRevenue) / totalPreviousRevenue : 0;
  const chartHeight = useMemo(() => {
    // Increase per-item height from 20 to 35 to ensure labels don't overlap
    return Math.max(400, (sortedData.length * 35) + 100);
  }, [sortedData]);
  const difference = totalCurrentRevenue - totalPreviousRevenue;
  const formatCompactNumber = (number: number) => {
    const thousand = 1_000;
    const million = 1_000_000;
    const billion = 1_000_000_000;

    if (Math.abs(number) >= billion) {
      return `${(number / billion).toFixed(0)} ${t('billion')}`;
    } else if (Math.abs(number) >= million) {
      return `${(number / million).toFixed(0)} ${t('million')}`;
    } else if (Math.abs(number) >= thousand) {
      return `${(number / thousand).toFixed(0)} ${t('thousand')}`;
    }
    return number.toString();
  };

  return (
    <div className="w-full h-full">
      <Card className="h-full flex flex-col">
        <CardHeader className="flex flex-col items-stretch space-y-0 border-b p-0 mb-2 sm:flex-row">
          <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
            <CardTitle>{t('RevenueByBranches.title')}</CardTitle>
            <div className="text-sm text-muted-foreground">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  {t('RevenueByBranches.currentRevenue')}:
                  <div className="font-bold">
                    {totalCurrentRevenue.toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {t('RevenueByBranches.previousRevenue')}:
                  <div className="font-bold">
                    {totalPreviousRevenue.toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {t('RevenueByBranches.difference')}:
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
                <span className="text-lg font-bold leading-none">{t('all')}</span>
              </button>
              {organizations.map((org) => {
                return (
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
                );
              })}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-2 pt-0 grow flex flex-col overflow-hidden">
          <div className="grow min-h-0 overflow-auto">
            <div style={{ height: chartHeight }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={sortedData}
                  margin={{ top: 0, right: 30, left: 0, bottom: 20 }}
                  barSize={20}
                  layout="vertical"
                  barGap={0}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    tickFormatter={(value) => formatCompactNumber(Number(value))}
                    domain={[0, (dataMax: number) => dataMax * 1.15]}
                    ticks={xAxisTicks}
                    minTickGap={2}
                    orientation="top"
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={200}
                    orientation="right"
                  />
                  <Tooltip content={<CustomTooltip currentTitle={t('RevenueByBranches.currentRevenue')} previousTitle={t('RevenueByBranches.previousRevenue')} />} />
                  <Legend verticalAlign="top" />
                  <Bar
                    dataKey="current_revenue"
                    name={t('RevenueByBranches.currentRevenue')}
                    fill="green"
                  />
                  <Bar
                    dataKey="previous_revenue"
                    name={t('RevenueByBranches.previousRevenue')}
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

export default RevenueByBranches;
