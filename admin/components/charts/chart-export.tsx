'use client';

import React from "react";
import { toPng } from "html-to-image";
import { Download, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@admin/components/ui/button";

export function useChartExport<T extends HTMLElement = HTMLDivElement>() {
    const ref = React.useRef<T>(null);
    const [exporting, setExporting] = React.useState(false);

    const exportPng = React.useCallback(async (filename: string) => {
        if (!ref.current) return;
        setExporting(true);
        try {
            const dataUrl = await toPng(ref.current, {
                pixelRatio: 2,
                backgroundColor: "#ffffff",
                filter: (node) =>
                    !(node instanceof HTMLElement && "exportIgnore" in node.dataset),
            });
            const link = document.createElement("a");
            link.download = `${filename}.png`;
            link.href = dataUrl;
            link.click();
        } catch (e) {
            console.error("Chart PNG export failed", e);
        } finally {
            setExporting(false);
        }
    }, []);

    return { ref, exportPng, exporting };
}

export function ChartExportButton({
    onExport,
    exporting = false,
}: {
    onExport: () => void;
    exporting?: boolean;
}) {
    const t = useTranslations();

    return (
        <Button
            variant="ghost"
            size="icon"
            data-export-ignore
            title={t("charts.exportPng")}
            aria-label={t("charts.exportPng")}
            disabled={exporting}
            onClick={onExport}
        >
            {exporting ? <Loader2 className="animate-spin" /> : <Download />}
        </Button>
    );
}
