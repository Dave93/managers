import React from "react";
import { ResponsiveHeatMapCanvas } from "@nivo/heatmap";
import { useSuspenseQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import {
    useQueryStates,
    parseAsIsoDateTime,
    parseAsString,
    useQueryState,
} from "nuqs";
import { Card, CardContent, CardHeader, CardTitle } from "@admin/components/ui/card";
import { DebugInfo } from "@admin/components/charts/DebugInfo";
import { useTranslations } from "next-intl";
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";

const fetchHourlyHeatmapData = async (
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
    console.log('status', status);
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

const OrderHourlyHeatmapChart = () => {
    const t = useTranslations();
    const [terminals] = useQueryState("terminals", parseAsString);
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
    const { data } = useSuspenseQuery({
        queryKey: ["hourlyHeatmap", startDate, endDate, terminals],
        queryFn: () =>
            fetchHourlyHeatmapData(
                startDate.toISOString(),
                endDate.toISOString(),
                terminals || undefined
            ),
    });

    const formattedData = React.useMemo(() => {
        if (!data) return [];

        const days = [
            t('charts.monday'),
            t('charts.tuesday'),
            t('charts.wednesday'),
            t('charts.thursday'),
            t('charts.friday'),
            t('charts.saturday'),
            t('charts.sunday')
        ];
        return days.map(day => ({
            id: day,
            data: Array.from({ length: 24 }, (_, hour) => {
                const hourData = data.data?.find(d => d.dayOfWeek === days.indexOf(day) && d.hour === hour);
                return {
                    x: hour.toString(),
                    y: hourData ? hourData.averageOrderCount : 0
                };
            })
        }));
    }, [data]);

    const maxValue = Math.max(...formattedData.flatMap(d => d.data.map(h => h.y)));

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="pb-0">
                <CardTitle>{t('charts.OrderHourlyHeatmapChart.title')}</CardTitle>
            </CardHeader>
            <CardContent className="p-6 pt-0 grow flex flex-col">
                <ResponsiveHeatMapCanvas
                    data={formattedData}
                    margin={{ top: 5, right: 0, bottom: 40, left: 50 }}
                    valueFormat=" >-.2s"
                    forceSquare={true}
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
                    labelTextColor={({ value }) => {
                        const threshold = maxValue * 0.7;
                        return value && value > threshold ? '#ffffff' : '#000000';
                    }}
                    colors={{
                        type: 'sequential',
                        scheme: 'blues'
                    }}
                    legends={[
                        {
                            anchor: 'bottom',
                            translateX: 0,
                            translateY: 20,
                            length: 200,
                            thickness: 10,
                            direction: 'row',
                            tickPosition: 'after',
                            tickSize: 3,
                            tickSpacing: 4,
                            tickOverlap: false,
                            tickFormat: '>-.2s',
                            titleAlign: 'start',
                            titleOffset: 4,
                        }
                    ]}
                    animate={false}
                    hoverTarget="cell"
                    tooltip={({ cell }) => (
                        <div style={{
                            color: 'black',
                            backgroundColor: 'white',
                            padding: '8px',
                            borderRadius: '4px',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }}>
                            <div><strong>{cell.serieId}</strong></div>
                            <div>{t('charts.time')}: {cell.data.x}:00</div>
                            <div>{t('charts.OrderHourlyHeatmapChart.averageOrderCount')}: {cell.data.y.toFixed(2)}</div>
                        </div>
                    )}
                />
                {data && 'debug' in data && data.debug && (
                    <div className="flex justify-end">
                        <DebugInfo sqlQueryTime={data.debug.sqlQueryTime} apiTime={data.debug.apiTime} />
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default OrderHourlyHeatmapChart;