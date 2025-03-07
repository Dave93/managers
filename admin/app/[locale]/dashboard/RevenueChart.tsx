"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@admin/components/ui/card";
import { Button } from "@admin/components/ui/buttonOrigin";
import {
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  BarChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { useSuspenseQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Tabs, TabsList, TabsTrigger } from "@admin/components/ui/tabs";
// import ExportExcelButton from "@admin/components/layout/ExportExcelButton";
import { ArrowDown, ArrowUp, ZoomOut } from "lucide-react";
import { formatDate, intervals } from "./intervalFunctions";
import { organizations } from "@admin/lib/organizations";
import { DebugInfo } from '@admin/components/charts/DebugInfo'
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { CustomTooltip } from "./CustomTooltip";
import { useTranslations } from 'next-intl';
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";

const fetchRevenueData = async (
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

  const { data, status } = await apiClient.api.charts.revenue.get({
    query,
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




const RevenueChart = () => {
  const t = useTranslations();
  const formatCompactNumber = (number: number) => {
    const billion = 1_000_000_000;
    const million = 1_000_000;
    const thousand = 1_000;

    if (Math.abs(number) >= billion) {
      return `${(number / billion).toFixed(0)} ${t('charts.billion')}`;
    } else if (Math.abs(number) >= million) {
      return `${(number / million).toFixed(0)} ${t('charts.million')}`;
    } else if (Math.abs(number) >= thousand) {
      return `${(number / thousand).toFixed(0)} ${t('charts.thousand')}`;
    }
    return number.toString();
  };
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
  const [interval, setInterval] = React.useState("1 day");
  const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
  const [refAreaRight, setRefAreaRight] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [endTime, setEndTime] = useState<string | null>(null);
  const [originalData, setOriginalData] = useState<any[]>([]);
  const [isSelecting, setIsSelecting] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);
  const { data } = useSuspenseQuery({
    queryKey: [
      "revenue",
      startDate,
      endDate,
      interval,
      terminals,
      organization,
    ],
    queryFn: () =>
      fetchRevenueData(
        startDate.toISOString(),
        endDate.toISOString(),
        interval,
        terminals ? terminals.toString() : undefined,
        organization ?? undefined
      ),
  });

  useEffect(() => {
    if (data && 'data' in data && data.data && data.data.length) {
      setOriginalData(data.data);
      setStartTime(data.data[0].date);
      setEndTime(data.data[data.data.length - 1].date);
    }
  }, [data]);

  const zoomedData = useMemo(() => {
    if (!startTime || !endTime) {
      if (data && 'data' in data && data.data && data.data.length) {
        return data.data
      } else {
        return []
      }
    }
    const dataPointsInRange = originalData.filter(
      (dataPoint) => dataPoint.date >= startTime && dataPoint.date <= endTime
    );
    return dataPointsInRange.length > 1
      ? dataPointsInRange
      : originalData.slice(0, 2);
  }, [startTime, endTime, originalData, data]);
  const totalCurrentRevenue = zoomedData.reduce(
    (sum, item) =>
      sum +
      (typeof item.current_revenue === "number" ? item.current_revenue : 0),
    0
  );
  const totalPreviousRevenue = zoomedData.reduce(
    (sum, item) =>
      sum +
      (typeof item.previous_revenue === "number" ? item.previous_revenue : 0),
    0
  );
  const percentChange =
    totalPreviousRevenue !== 0
      ? (totalCurrentRevenue - totalPreviousRevenue) / totalPreviousRevenue
      : 0;
  const handleMouseDown = (e: any) => {
    if (e.activeLabel) {
      setRefAreaLeft(e.activeLabel);
      setIsSelecting(true);
    }
  };
  const difference = totalCurrentRevenue - totalPreviousRevenue;
  const handleMouseMove = (e: any) => {
    if (isSelecting && e.activeLabel) {
      setRefAreaRight(e.activeLabel);
    }
  };
  const handleMouseUp = () => {
    if (refAreaLeft && refAreaRight) {
      const [left, right] = [refAreaLeft, refAreaRight].sort();
      setStartTime(left);
      setEndTime(right);
    }
    setRefAreaLeft(null);
    setRefAreaRight(null);
    setIsSelecting(false);
  };
  const handleReset = () => {
    setStartTime(originalData[0].date);
    setEndTime(originalData[originalData.length - 1].date);
  };
  const handleZoom = (
    e: React.WheelEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>
  ) => {
    e.preventDefault();
    if (!originalData.length || !chartRef.current) return;

    let zoomFactor = 0.1;
    let direction = 0;
    let clientX = 0;

    if ("deltaY" in e) {
      // Mouse wheel event
      direction = e.deltaY < 0 ? 1 : -1;
      clientX = e.clientX;
    } else if (e.touches.length === 2) {
      // Pinch zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const currentDistance = Math.hypot(
        touch1.clientX - touch2.clientX,
        touch1.clientY - touch2.clientY
      );

      if ((e as any).lastTouchDistance) {
        direction = currentDistance > (e as any).lastTouchDistance ? 1 : -1;
      }
      (e as any).lastTouchDistance = currentDistance;

      clientX = (touch1.clientX + touch2.clientX) / 2;
    } else {
      return;
    }
    const currentRange =
      new Date(
        endTime || originalData[originalData.length - 1].date
      ).getTime() - new Date(startTime || originalData[0].date).getTime();
    const zoomAmount = currentRange * zoomFactor * direction;
    const chartRect = chartRef.current.getBoundingClientRect();
    const mouseX = clientX - chartRect.left;
    const chartWidth = chartRect.width;
    const mousePercentage = mouseX / chartWidth;
    const currentStartTime = new Date(
      startTime || originalData[0].date
    ).getTime();
    const currentEndTime = new Date(
      endTime || originalData[originalData.length - 1].date
    ).getTime();

    const newStartTime = new Date(
      currentStartTime + zoomAmount * mousePercentage
    );
    const newEndTime = new Date(
      currentEndTime - zoomAmount * (1 - mousePercentage)
    );

    setStartTime(newStartTime.toISOString());
    setEndTime(newEndTime.toISOString());
  };

  const localizedIntervals = intervals(t);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-col items-stretch space-y-0 border-b p-0 mb-2 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle>{t('charts.RevenueChart.title')}</CardTitle>
          <div className="text-sm text-muted-foreground">
            <div className="flex items-center gap-1">
              {t('charts.RevenueChart.currentRevenue')}:
              <div className="font-bold">
                {totalCurrentRevenue.toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {t('charts.RevenueChart.previousRevenue')}:
              <div className="font-bold">
                {totalPreviousRevenue.toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {t('charts.RevenueChart.difference')}:
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
              data-active={!organization || organization.length == 0}
              className="relative z-30 flex flex-1 flex-col justify-center gap-1 border-t p-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0"
              onClick={() => setOrganization("")}
            >
              <span className="text-lg font-bold leading-none">{t('charts.all')}</span>
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
      <CardContent className="grow flex flex-col">
        <div className="grow">
          <div
            className="h-full"
            onWheel={handleZoom}
            onTouchMove={handleZoom}
            ref={chartRef}
            style={{ touchAction: "none" }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={zoomedData}
                margin={{
                  top: 10,
                  right: 10,
                  left: 20,
                  bottom: 0,
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                barGap={0}
                barCategoryGap="20%"
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => formatDate(value, interval)}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={4}
                  minTickGap={16}
                  style={{ fontSize: "15px", userSelect: "none" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  style={{ fontSize: "15px", userSelect: "none" }}
                  tickFormatter={(value) => formatCompactNumber(Number(value))}
                  orientation="right"
                  tickMargin={4}
                />
                <Tooltip content={<CustomTooltip interval={interval} currentTitle={t('charts.RevenueChart.currentRevenue')} previousTitle={t('charts.RevenueChart.previousRevenue')} differenceTitle={t('charts.RevenueChart.difference')} />} />
                <Legend
                  verticalAlign="top"
                  wrapperStyle={{
                    top: "0px",
                  }}
                />
                <Bar
                  dataKey="current_revenue"
                  fill="green"
                  name={t('charts.RevenueChart.currentRevenue')}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
                <Bar
                  dataKey="previous_revenue"
                  fill="gray"
                  name={t('charts.RevenueChart.previousRevenue')}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
                {refAreaLeft && refAreaRight && (
                  <ReferenceArea
                    x1={refAreaLeft}
                    x2={refAreaRight}
                    strokeOpacity={0.3}
                    fill="hsl(var(--foreground))"
                    fillOpacity={0.05}
                  />
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="flex justify-between w-full items-center">
          <Tabs value={interval} onValueChange={setInterval}>
            <TabsList>
              {localizedIntervals.map((int) => (
                <TabsTrigger key={int.value} value={int.value}>
                  {int.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex space-x-2">
            {/* <ExportExcelButton
              startDate={startDate}
              endDate={endDate}
              interval={interval}
              terminals={terminals ? terminals.toString() : undefined}
              endpoint="api/charts/revenue/export"
              filename="revenue_data"
            /> */}
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={!startTime && !endTime}
              size="sm"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            {data && 'debug' in data && data.debug && (
              <DebugInfo sqlQueryTime={data.debug.sqlQueryTime} apiTime={data.debug.apiTime} />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default RevenueChart;

