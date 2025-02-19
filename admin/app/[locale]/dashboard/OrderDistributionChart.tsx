import React, { useState, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@admin/components/ui/card";
import {
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
  Cell,
} from "recharts";
import { useSuspenseQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { useQueryStates, parseAsIsoDateTime } from "nuqs";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { organizations } from "@admin/lib/organizations";
import { DebugInfo } from "@admin/components/charts/DebugInfo";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { useTranslations } from "next-intl";

const COLORS = {
  current: "#22c55e",  // зеленый для текущего периода
  previous: "#94a3b8"  // серый для предыдущего периода
};

interface OrderDistributionData {
  name: string;
  value: number;
}

interface ApiResponse {
  data: {
    current: OrderDistributionData[];
    previous: OrderDistributionData[];
  };
  debug?: {
    sqlQueryTime: number;
    apiTime: number;
  };
}

// Добавляем тип для ответа API
type ApiResult = {
  data: ApiResponse;
  error?: unknown;
  status: number;
} | null;

const fetchOrderDistributionData = async (
  startDate: string,
  endDate: string,
  terminals?: string,
  organizationId?: string
): Promise<ApiResponse> => {
  if (!startDate || !endDate) {
    throw new Error("Date filter is mandatory");
  }

  const query = {
    startDate,
    endDate,
    ...(terminals && { terminals }),
    ...(organizationId && { organizationId }),
  };

  const result = await apiClient.api.charts["order-distribution"].get({
    query
  }) as ApiResult;

  if (!result || result.status !== 200 || !result.data) {
    const errorMessage = (result?.data && typeof result.data === "object" && "message" in result.data)
      ? String(result.data.message)
      : "Error fetching data";
    throw new Error(errorMessage);
  }

  return result.data;
};

const formatCompactNumber = (number: number) => {
  const million = 1_000_000;
  const thousand = 1_000;

  if (Math.abs(number) >= million) {
    return `${(number / million).toFixed(1)}M`;
  } else if (Math.abs(number) >= thousand) {
    return `${(number / thousand).toFixed(1)}K`;
  }
  return number.toString();
};

// Добавляем компонент для тултипа
const DistributionTooltip = ({ active, payload }: any) => {
  if (!active || !payload || !payload.length) {
    return null;
  }

  return (
    <div className="rounded-lg border bg-background p-2 shadow-sm">
      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="font-semibold">{payload[0].payload.name}</div>
          </div>
        </div>
        {payload.map((entry: any, index: number) => (
          <div key={`id-${index}`} className="flex items-center gap-2">
            <div
              className="h-2 w-2 rounded-full"
              style={{ background: entry.color }}
            />
            <span className="flex-1">{entry.name}:</span>
            <span className="font-medium">
              {entry.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const OrderDistributionChart = () => {
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
  const [organization, setOrganization] = useState<string | null>(null);
  const [terminals] = useTerminalsFilter();

  const { data, error } = useSuspenseQuery({
    queryKey: ["orderDistribution", startDate, endDate, terminals, organization],
    queryFn: () => fetchOrderDistributionData(
      startDate.toISOString(),
      endDate.toISOString(),
      terminals ? terminals.toString() : undefined,
      organization || undefined
    ),
  });

  const currentTotalOrders = useMemo(() =>
    data?.data.current.reduce((sum, item) => sum + item.value, 0) || 0,
    [data]
  );

  const previousTotalOrders = useMemo(() =>
    data?.data.previous.reduce((sum, item) => sum + item.value, 0) || 0,
    [data]
  );

  const difference = currentTotalOrders - previousTotalOrders;
  const percentChange = previousTotalOrders !== 0
    ? (currentTotalOrders - previousTotalOrders) / previousTotalOrders
    : 0;

  // Подготавливаем данные для общего графика
  const combinedData = useMemo(() => {
    if (!data?.data) return [];
    return data.data.current.map(item => ({
      name: item.name,
      current: item.value,
      previous: data.data.previous.find(p => p.name === item.name)?.value || 0
    }));
  }, [data]);

  if (error) {
    return (
      <Card className="h-full flex flex-col">
        <CardHeader>
          <CardTitle>{t('charts.OrderDistributionChart.title')}</CardTitle>
        </CardHeader>
        <CardContent className="flex-grow flex items-center justify-center">
          <p>Ошибка загрузки данных: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-col items-stretch space-y-0 border-b p-0 mb-2 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle>{t('charts.OrderDistributionChart.title')}</CardTitle>
          <div className="text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              {t('charts.OrderDistributionChart.current')}:
              <div className="font-bold">
                {currentTotalOrders.toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {t('charts.OrderDistributionChart.previous')}:
              <div className="font-bold">
                {previousTotalOrders.toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {t('charts.OrderDistributionChart.difference')}:
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
        {!terminals && (
          <div className="flex">
            <button
              data-active={!organization}
              className="relative z-30 flex flex-1 flex-col justify-center gap-1 border-t p-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0"
              onClick={() => setOrganization(null)}
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
                <span className="text-lg font-bold leading-none">{org.label}</span>
              </button>
            ))}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex-grow flex flex-col">
        <div className="flex-grow">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={combinedData}
              margin={{ top: 10, right: 30, left: 20, bottom: 5 }}
              barGap={0}
              barCategoryGap="20%"
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="name"
                tickLine={false}
                axisLine={false}
                tickMargin={4}
                minTickGap={16}
                style={{ fontSize: "15px", userSelect: "none" }}
              />
              <YAxis
                tickFormatter={formatCompactNumber}
                tickLine={false}
                axisLine={false}
                style={{ fontSize: "15px", userSelect: "none" }}
                orientation="right"
                tickMargin={4}
              />
              <Tooltip
                content={<DistributionTooltip />}
              />
              <Legend
                verticalAlign="top"
                wrapperStyle={{
                  top: "0px",
                }}
              />
              <Bar
                dataKey="current"
                name={t('charts.OrderDistributionChart.current')}
                fill={COLORS.current}
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
              <Bar
                dataKey="previous"
                name={t('charts.OrderDistributionChart.previous')}
                fill={COLORS.previous}
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {data.debug && (
          <div className="flex justify-end">
            <DebugInfo sqlQueryTime={data.debug.sqlQueryTime} apiTime={data.debug.apiTime} />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default OrderDistributionChart;
