'use client';

import React from "react";
import dynamic from 'next/dynamic';

// Define our own data type that matches what we're actually using
export type HeatmapDataItem = {
    x: string;
    y: number;
};

export type HeatmapSeries = {
    id: string;
    data: HeatmapDataItem[];
}[];

// Define the props we need without relying on Nivo's types
export type HeatmapChartProps = {
    data: HeatmapSeries;
    margin?: { top: number; right: number; bottom: number; left: number };
    valueFormat?: string;
    forceSquare?: boolean;
    axisRight?: any;
    axisBottom?: any;
    axisLeft?: any;
    borderColor?: any;
    labelTextColor?: any;
    renderCell?: string;
    legends?: any[];
    animate?: boolean;
    hoverTarget?: string;
    colors?: any;
    tooltip?: any;
    [key: string]: any; // Allow any other props
};

// Create a wrapper component that will load the actual component
const HeatmapChartWrapper = (props: HeatmapChartProps) => {
    // This component will be loaded only on the client side
    const NivoHeatmap = React.useMemo(() => {
        return dynamic(
            () => import('./NivoHeatmapComponent'),
            { ssr: false }
        );
    }, []);

    return (
        <div style={{ width: '100%', height: '100%' }}>
            <NivoHeatmap {...props} />
        </div>
    );
};

export { HeatmapChartWrapper as HeatmapChartClient }; 