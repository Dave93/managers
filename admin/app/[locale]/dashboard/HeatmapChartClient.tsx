'use client';

import React from "react";
import dynamic from 'next/dynamic';
import { HeatMapCanvasProps } from "@nivo/heatmap";

// Define our own data type that matches what we're actually using
export type HeatmapDataItem = {
    x: string;
    y: number;
};

export type HeatmapSeries = {
    id: string;
    data: HeatmapDataItem[];
}[];

// Create a more flexible props type that matches our actual data structure
export type HeatmapChartProps = Omit<
    HeatMapCanvasProps<any, any>,
    "width" | "height"
> & {
    data: HeatmapSeries;
};

// Dynamically import the Nivo component to avoid SSR issues
const ResponsiveHeatMapCanvas = dynamic(
    () => import('@nivo/heatmap').then(mod => mod.ResponsiveHeatMapCanvas),
    { ssr: false }
);

export function HeatmapChartClient(props: HeatmapChartProps) {
    return (
        <div style={{ width: '100%', height: '100%' }}>
            {/* @ts-ignore - We're ignoring type issues here as we know our data format works with the component */}
            <ResponsiveHeatMapCanvas {...props} />
        </div>
    );
} 