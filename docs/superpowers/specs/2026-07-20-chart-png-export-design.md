# Chart PNG Export — Design

Date: 2026-07-20

## Goal

Allow exporting dashboard chart widgets as PNG images. First consumers: the two
hourly heatmaps (`OrderHourlyHeatmapChart`, `OrderAmountHourlyHeatmapChart`).
The mechanism must be reusable so any other dashboard card can adopt it later.

## Approach

Use `html-to-image` (`toPng`) on the whole `Card` DOM node. This captures the
card title, the Nivo canvas, and the legend in one shot, and reads computed
styles — so Tailwind v4 `oklch` colors work (html2canvas would fail on them).

Rejected alternatives:
- Copying the Nivo `<canvas>` into a new canvas by hand: misses card title and
  styling, requires manual text drawing.
- `html2canvas`: breaks on `oklch` colors used by Tailwind v4.

## Components

`admin/components/charts/chart-export.tsx`:

- `useChartExport()` — returns `{ ref, exportPng, exporting }`. `ref` attaches
  to the `Card`. `exportPng(filename)` renders the node to PNG at
  `pixelRatio: 2` with a forced white background and triggers a download of
  `<filename>.png`. Nodes marked `data-export-ignore` are excluded via the
  `filter` option.
- `ChartExportButton` — ghost icon button (lucide `Download`), marked
  `data-export-ignore` so it never appears in the exported image. Localized
  `title`/`aria-label` via `charts.exportPng` message key (en, ru, uz-Latn,
  uz-Cyrl).

## Widget integration

In each heatmap component:
- attach `ref` to `<Card>`;
- place `<ChartExportButton>` inside `CardHeader` using the `CardAction` slot;
- filename pattern: `<widget-slug>_<from>_<to>.png` with dates formatted
  `yyyy-MM-dd` via `date-fns`;
- `DebugInfo` block gets `data-export-ignore`.

## Error handling

`exportPng` is a no-op when the ref is empty; failures reject silently to the
console — export is a convenience action, no user-facing error state beyond the
button re-enabling.

## Testing

No project-wide test runner (per CLAUDE.md). Verification: `bun lint` in
`admin/` plus manual click-through of both widgets.
