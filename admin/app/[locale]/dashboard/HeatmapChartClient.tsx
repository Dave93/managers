'use client';

import React from "react";
import { ResponsiveHeatMapCanvas } from "@nivo/heatmap";
import type { HeatMapCanvasProps, HeatMapDatum, DefaultHeatMapDatum } from "@nivo/heatmap";

type HeatmapChartClientProps<Datum extends HeatMapDatum = DefaultHeatMapDatum> = Omit<
    HeatMapCanvasProps<Datum, Record<string, never>>,
    "width" | "height"
>;

export function HeatmapChartClient<Datum extends HeatMapDatum = DefaultHeatMapDatum>(
    props: HeatmapChartClientProps<Datum>
) {
    return <ResponsiveHeatMapCanvas {...props} />;
} 