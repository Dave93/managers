'use client';

import React from 'react';
import { ResponsiveHeatMapCanvas } from '@nivo/heatmap';
import { HeatmapChartProps } from './HeatmapChartClient';

// This component is only imported on the client side
export default function NivoHeatmapComponent(props: HeatmapChartProps) {
    // @ts-ignore - We're ignoring type issues here as we know our data format works with the component
    return <ResponsiveHeatMapCanvas {...props} />;
} 