"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@admin/components/ui/card";
import { Button } from "@admin/components/ui/buttonOrigin";
import {
    Line,
    CartesianGrid,
    XAxis,
    YAxis,
    LineChart,
    ReferenceArea,
    ResponsiveContainer,
    Tooltip,
    Legend,
} from "recharts";
import { useSuspenseQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Tabs, TabsList, TabsTrigger } from "@admin/components/ui/tabs";
import { ZoomOut } from "lucide-react";
import { formatDate, intervals } from "./intervalFunctions";
import { useTerminalsFilter } from "@admin/components/filters/terminals/terminals-filter.hook";
import { useTranslations } from 'next-intl';
import { useDateRangeState } from "@admin/components/filters/date-range-filter/date-range-state.hook";
import dayjs from "dayjs";
import { organizations } from "@admin/lib/organizations";

interface BasketAdditionalSalesTrendData {
    date: string;
    source: string;
    total_sales: number;
}

interface BasketAdditionalSalesTrendResponse {
    data: BasketAdditionalSalesTrendData[];
    debug: {
        sqlQueryTime: number;
        apiTime: number;
    };
}

const fetchBasketAdditionalSalesTrend = async (
    startDate: string,
    endDate: string,
    interval: string,
    terminals?: string,
    organization?: string
) => {
    if (!startDate || !endDate) {
        throw new Error("Date filter is mandatory");
    }

    let query: {
        startDate: string;
        endDate: string;
        interval: string;
        terminals?: string | undefined;
        organization?: string | undefined;
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

    if (organization) {
        query = {
            ...query,
            organization,
        };
    }

    const { data, status } = await apiClient.api.charts["basket-additional-sales-trend"].get({
        query,
    });

    if (status !== 200 || !data) {
        throw new Error("Failed to fetch basket additional sales trend data");
    }

    return data as BasketAdditionalSalesTrendResponse;
};

// Custom tooltip component
const CustomTooltip = ({ active, payload, label, interval }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-background p-3 border rounded-md shadow-md">
                <p className="font-medium">{formatDate(label, interval)}</p>
                {payload.map((entry: any, index: number) => (
                    <div key={`item-${index}`} className="flex items-center gap-2">
                        <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: entry.color }}
                        />
                        <p className="text-sm">
                            {entry.name}: {entry.value.toLocaleString('ru-RU')} UZS
                        </p>
                    </div>
                ))}
            </div>
        );
    }

    return null;
};

// Format number for Y-axis
const formatYAxis = (value: number) => {
    if (value >= 1_000_000) {
        return `${(value / 1_000_000).toFixed(1)}M`;
    } else if (value >= 1_000) {
        return `${(value / 1_000).toFixed(1)}K`;
    }
    return value.toString();
};

// Generate colors for different sources
const generateColors = (count: number) => {
    const colors = [
        "#8884d8", "#82ca9d", "#ffc658", "#ff8042", "#0088FE",
        "#00C49F", "#FFBB28", "#FF8042", "#a4de6c", "#d0ed57"
    ];

    // If we need more colors than available, generate them
    if (count > colors.length) {
        for (let i = colors.length; i < count; i++) {
            const hue = (i * 137.5) % 360; // Golden angle approximation for good distribution
            colors.push(`hsl(${hue}, 70%, 60%)`);
        }
    }

    return colors.slice(0, count);
};

const BasketAdditionalSalesTrendChart = () => {
    const t = useTranslations("");
    const { dateRange } = useDateRangeState();
    const { startDate, endDate } = useMemo(() => ({
        startDate: dateRange?.from ?? new Date(),
        endDate: dateRange?.to ?? new Date()
    }), [dateRange]);
    const [terminals] = useTerminalsFilter();
    const [organization, setOrganization] = useState<string>("");
    const [interval, setInterval] = useState("1 day");

    // For zoom functionality
    const [refAreaLeft, setRefAreaLeft] = useState<string | null>(null);
    const [refAreaRight, setRefAreaRight] = useState<string | null>(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const [startTime, setStartTime] = useState<string | null>(null);
    const [endTime, setEndTime] = useState<string | null>(null);
    const chartRef = useRef<HTMLDivElement>(null);

    const queryParams = useMemo(() => ({
        startDate: dayjs(startDate).format('YYYY-MM-DD'),
        endDate: dayjs(endDate).format('YYYY-MM-DD'),
        interval,
        terminals: terminals?.toString(),
        organization: organization ? organization : undefined
    }), [startDate, endDate, interval, terminals, organization]);

    const { data } = useSuspenseQuery<BasketAdditionalSalesTrendResponse>({
        queryKey: ["basket-additional-sales-trend", queryParams],
        queryFn: async () => {
            const response = await fetchBasketAdditionalSalesTrend(
                queryParams.startDate,
                queryParams.endDate,
                queryParams.interval,
                queryParams.terminals,
                queryParams.organization
            );
            return response;
        },
    });

    // Process data for the chart
    const { chartData, sources, originalData } = useMemo(() => {
        if (!data?.data) return { chartData: [], sources: [], originalData: [] };

        // Extract unique sources and dates
        const uniqueSources = Array.from(new Set(data.data.map(item => item.source)));
        const uniqueDates = Array.from(new Set(data.data.map(item => item.date))).sort();

        // Create a map for quick lookup
        const dataMap = new Map();
        data.data.forEach(item => {
            const key = `${item.date}-${item.source}`;
            dataMap.set(key, item.total_sales);
        });

        // Create chart data with all sources for each date
        const processedData = uniqueDates.map(date => {
            const entry: any = { date };
            uniqueSources.forEach(source => {
                const key = `${date}-${source}`;
                entry[source] = dataMap.get(key) || 0;
            });
            return entry;
        });

        return {
            chartData: processedData,
            sources: uniqueSources,
            originalData: processedData
        };
    }, [data]);

    // Filter data based on zoom selection
    const filteredData = useMemo(() => {
        if (!startTime || !endTime || !originalData.length) return chartData;

        return chartData.filter(
            (entry) => entry.date >= startTime && entry.date <= endTime
        );
    }, [chartData, startTime, endTime, originalData]);

    // Generate colors for the sources
    const colors = useMemo(() => generateColors(sources.length), [sources]);

    // Zoom functionality
    const handleMouseDown = (e: any) => {
        if (e.activeLabel) {
            setRefAreaLeft(e.activeLabel);
            setIsSelecting(true);
        }
    };

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
        if (originalData.length) {
            setStartTime(null);
            setEndTime(null);
        }
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

        // Get chart dimensions
        const chartRect = chartRef.current.getBoundingClientRect();
        const chartWidth = chartRect.width;
        const relativeX = (clientX - chartRect.left) / chartWidth;

        // Current data range
        const currentData = filteredData.length ? filteredData : originalData;
        if (currentData.length < 2) return;

        const startIndex = startTime
            ? currentData.findIndex((d) => d.date === startTime)
            : 0;
        const endIndex = endTime
            ? currentData.findIndex((d) => d.date === endTime)
            : currentData.length - 1;

        // Calculate new range
        const rangeSize = endIndex - startIndex;
        const zoomChange = Math.max(1, Math.round(rangeSize * zoomFactor));

        let newStartIndex = startIndex;
        let newEndIndex = endIndex;

        if (direction > 0) {
            // Zoom in
            newStartIndex = Math.min(
                endIndex - 1,
                startIndex + Math.round(zoomChange * relativeX)
            );
            newEndIndex = Math.max(
                startIndex + 1,
                endIndex - Math.round(zoomChange * (1 - relativeX))
            );
        } else {
            // Zoom out
            newStartIndex = Math.max(
                0,
                startIndex - Math.round(zoomChange * relativeX)
            );
            newEndIndex = Math.min(
                originalData.length - 1,
                endIndex + Math.round(zoomChange * (1 - relativeX))
            );
        }

        // Update state with new range
        if (newStartIndex !== startIndex || newEndIndex !== endIndex) {
            setStartTime(originalData[newStartIndex].date);
            setEndTime(originalData[newEndIndex].date);
        }
    };

    return (
        <Card className="h-full">
            <CardHeader className="flex flex-col items-stretch space-y-0 border-b pb-2 sm:flex-row">
                <div className="flex flex-1 flex-col justify-center px-6 py-2">
                    <CardTitle className="text-sm font-medium">
                        {t("charts.basketAdditionalSalesTrend.title")}
                    </CardTitle>
                </div>
                {!terminals && (
                    <div className="flex mt-2 sm:mt-0">
                        <button
                            data-active={!organization || organization.length == 0}
                            className="relative z-30 flex flex-1 flex-col justify-center gap-1 border-t p-2 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0"
                            onClick={() => setOrganization("")}
                        >
                            <span className="text-sm font-bold leading-none">{t('charts.basketAdditionalSalesTrend.all')}</span>
                        </button>
                        {organizations.map((org) => {
                            return (
                                <button
                                    key={org.id}
                                    data-active={organization === org.id}
                                    className="relative z-30 flex flex-1 flex-col justify-center gap-1 border-t p-2 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0"
                                    onClick={() => setOrganization(org.id)}
                                >
                                    <span className="text-sm font-bold leading-none">
                                        {org.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                )}
                <div className="flex items-center space-x-2 mt-2 sm:mt-0 justify-end px-6 py-2">
                    <Tabs
                        defaultValue={interval}
                        onValueChange={setInterval}
                        className="h-8"
                    >
                        <TabsList className="h-8">
                            {intervals(t).map((i) => (
                                <TabsTrigger
                                    key={i.value}
                                    value={i.value}
                                    className="text-xs h-8"
                                >
                                    {i.label}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </Tabs>
                    {(startTime || endTime) && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleReset}
                            className="h-8"
                        >
                            <ZoomOut className="h-4 w-4 mr-1" />
                            {t("charts.basketAdditionalSalesTrend.resetZoom")}
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent className="h-[calc(100%-60px)]">
                <div
                    ref={chartRef}
                    className="h-full w-full"
                    onWheel={handleZoom}
                    onTouchStart={(e) => {
                        if (e.touches.length === 2) {
                            (e as any).lastTouchDistance = Math.hypot(
                                e.touches[0].clientX - e.touches[1].clientX,
                                e.touches[0].clientY - e.touches[1].clientY
                            );
                        }
                    }}
                    onTouchMove={handleZoom}
                >
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                            data={filteredData}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                        >
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis
                                dataKey="date"
                                tickFormatter={(value) => formatDate(value, interval)}
                                minTickGap={30}
                            />
                            <YAxis tickFormatter={formatYAxis} />
                            <Tooltip content={<CustomTooltip interval={interval} />} />
                            <Legend />
                            {sources.map((source, index) => (
                                <Line
                                    key={source}
                                    type="monotone"
                                    dataKey={source}
                                    name={source}
                                    stroke={colors[index % colors.length]}
                                    activeDot={{ r: 8 }}
                                    strokeWidth={2}
                                />
                            ))}
                            {refAreaLeft && refAreaRight && (
                                <ReferenceArea
                                    x1={refAreaLeft}
                                    x2={refAreaRight}
                                    strokeOpacity={0.3}
                                    fill="#8884d8"
                                    fillOpacity={0.3}
                                />
                            )}
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </CardContent>
        </Card>
    );
};

export default BasketAdditionalSalesTrendChart; 