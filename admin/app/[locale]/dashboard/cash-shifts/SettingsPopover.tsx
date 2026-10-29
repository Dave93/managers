"use client";
import { Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@admin/components/ui/popover";
import { useCashShiftSettings } from "@admin/store/states/cash_shift_settings";

export default function SettingsPopover() {
  const t = useTranslations("dashboardUi.cashShifts.settings");
  const s = useCashShiftSettings();
  const numberField = (
    id: string,
    value: number,
    onChange: (v: number) => void,
    min: number,
    max: number
  ) => (
    <Input
      id={id}
      type="number"
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= min && v <= max) onChange(v);
      }}
      className="h-8 w-28 shrink-0 tabular-nums"
    />
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("ariaLabel")}
          className="text-muted-foreground hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <p className="text-sm font-semibold">{t("title")}</p>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="cs-late-open" className="font-normal leading-snug">
            {t("lateOpenAfter")}
          </Label>
          <Input
            id="cs-late-open"
            type="time"
            value={s.lateOpenAfter}
            onChange={(e) => s.update({ lateOpenAfter: e.target.value })}
            className="h-8 w-28 shrink-0 tabular-nums"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="cs-late-close" className="font-normal leading-snug">
            {t("lateCloseAfter")}
          </Label>
          <Input
            id="cs-late-close"
            type="time"
            value={s.lateCloseAfter}
            onChange={(e) => s.update({ lateCloseAfter: e.target.value })}
            className="h-8 w-28 shrink-0 tabular-nums"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="cs-max-hours" className="font-normal leading-snug">
            {t("shiftLongerHours")}
          </Label>
          {numberField("cs-max-hours", s.maxDurationHours, (v) => s.update({ maxDurationHours: v }), 1, 48)}
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="cs-hide-short" className="font-normal leading-snug">
            {t("hideShorterMin")}
          </Label>
          {numberField("cs-hide-short", s.hideShorterThanMin, (v) => s.update({ hideShorterThanMin: v }), 0, 120)}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("note")}
        </p>
        <Button variant="outline" size="sm" onClick={s.reset} className="w-full">
          {t("reset")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
