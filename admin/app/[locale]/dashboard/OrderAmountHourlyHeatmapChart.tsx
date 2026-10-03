'use client';

import React from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
    useQueryStates,
    parseAsIsoDateTime,
    parseAsString,
    useQueryState,
} from "nuqs";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import { ChartExportButton, useChartExport } from "@admin/components/charts/chart-export";
import { HeatmapChartClient } from "./HeatmapChartClient";
import ChartCard from "./_tremor/ChartCard";
import { useIsMobile } from "@admin/utils/use-is-mobile";

const fetchHourlyAmountHeatmapData = async (
    startDate: string,
    endDate: string,
    terminals?: string
) => {
    if (!startDate || !endDate) {
        throw new Error("Date filter is mandatory");
    }

    const query = {
        startDate,
        endDate,
        ...(terminals && { terminals }),
    };

    const { data, error, status } = await apiClient.api.charts["hourly-heatmap"].get({
        query
    });

    if (status !== 200) {
        let errorMessage = "Error fetching data";
        if (data && typeof data === "object" && "message" in data) {
            errorMessage = String(data.message);
        }
        throw new Error(errorMessage);
    }

    if (!data?.data || !Array.isArray(data.data)) {
        throw new Error("No data found or invalid data format");
    }

    return data;
};

const OrderAmountHourlyHeatmapChart = () => {
    const t = useTranslations();
    const isMobile = useIsMobile();

    // Move 'now' inside a useMemo to avoid recreating it on every render
    const now = React.useMemo(() => new Date(), []);

    const { dateRange } = useDateRangeState();
    const { startDate, endDate } = React.useMemo(() => {
        if (dateRange) {
            return {
                startDate: dateRange.from!,
                endDate: dateRange.to!,
            };
        }
        return {
            startDate: new Date(now.getFullYear(), now.getMonth(), 1),
            endDate: new Date(now.getFullYear(), now.getMonth() + 1, 0),
        };
    }, [dateRange, now]);
    const [terminals] = useQueryState("terminals", parseAsString);

    const { data } = useSuspenseQuery({
        queryKey: ["hourlyAmountHeatmap", startDate, endDate, terminals],
        queryFn: () =>
            fetchHourlyAmountHeatmapData(
                startDate.toISOString(),
                endDate.toISOString(),
                terminals || undefined
            ),
    });

    const formattedData = React.useMemo(() => {
        if (!data) return [];

        const days = [t('charts.monday'), t('charts.tuesday'), t('charts.wednesday'), t('charts.thursday'), t('charts.friday'), t('charts.saturday'), t('charts.sunday')];
        return days.map(day => ({
            id: day,
            data: Array.from({ length: 24 }, (_, hour) => {
                const hourData = data.data!.find((d: any) => d.dayOfWeek === days.indexOf(day) && d.hour === hour);
                return {
                    x: hour.toString(),
                    y: hourData ? hourData.averageRevenue : 0
                };
            })
        }));
    }, [data, t]);

    const maxValue = Math.max(...formattedData.flatMap(d => d.data.map(h => h.y)));

    const { ref: exportRef, exportPng, exporting } = useChartExport();

    return (
        <ChartCard
            title={t('charts.OrderAmountHourlyHeatmapChart.title')}
            cardRef={exportRef}
            headerRight={
                <ChartExportButton
                    exporting={exporting}
                    onExport={() =>
                        exportPng(
                            `orders-amount-hourly-heatmap_${format(startDate, "yyyy-MM-dd")}_${format(endDate, "yyyy-MM-dd")}`
                        )
                    }
                />
            }
        >
                <HeatmapChartClient
                    data={formattedData}
                    enableLabels={!isMobile}
                    margin={{ top: 5, right: 0, bottom: 40, left: 50 }}
                    valueFormat=" >-.2s"
                    forceSquare={!isMobile}
                    axisRight={null}
                    axisBottom={null}
                    axisLeft={{
                        tickSize: 5,
                        tickPadding: 5,
                        tickRotation: 0,
                        legend: t('charts.dayOfTheWeek'),
                        legendPosition: 'middle',
                        legendOffset: -40
                    }}
                    borderColor={{ from: 'color', modifiers: [['darker', 0.4]] }}
                    labelTextColor={({ value }: { value: number }) => {
                        const threshold = maxValue * 0.7;
                        return value && value > threshold ? '#ffffff' : '#000000';
                    }}
                    renderCell="rect"
                    legends={[
                        {
                            anchor: 'bottom',
                            translateX: 0,
                            translateY: 20,
                            length: 400,
                            thickness: 10,
                            direction: 'row',
                            tickPosition: 'after',
                            tickSize: 3,
                            tickSpacing: 10,
                            tickOverlap: false,
                            tickFormat: '>-.2s',
                            titleAlign: 'start',
                            titleOffset: 4
                        }
                    ]}
                    animate={false}
                    hoverTarget="cell"
                    colors={{
                        type: 'sequential',
                        scheme: 'blue_green'
                    }}
                    tooltip={({ cell }: { cell: { serieId: string; data: { x: string; y: number }; } }) => {
                        const formatter = new Intl.NumberFormat('ru-RU', {
                            style: 'currency',
                            currency: 'UZS',
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0,
                        });
                        const formattedSum = formatter.format(cell.data.y);
                        return (
                            <div style={{
                                color: 'black',
                                backgroundColor: 'white',
                                padding: '8px',
                                borderRadius: '4px',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                            }}>
                                <div><strong>{cell.serieId}</strong></div>
                                <div>{t('charts.time')}: {cell.data.x}:00</div>
                                <div>{t('charts.AverageCheckChart.averageCheck')}: {formattedSum}</div>
                            </div>
                        );
                    }}
                />
        </ChartCard>
    );
};

export default OrderAmountHourlyHeatmapChart;