"use client";
import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Textarea } from "@admin/components/ui/textarea";
import { cn } from "@admin/lib/utils";
import type { ReviewFormItem } from "@admin/lib/kpi-api";
import { formatTashkent } from "@admin/lib/kpi/format";
import {
  SCORE_BUTTONS,
  issueText,
  parseScoreInput,
  pickScore,
  scoreTextChange,
  staleNoteHint,
  type DraftItem,
  type IssueCode,
} from "@admin/lib/kpi/review-form";
import { SOURCE_LABEL_KEY } from "@admin/lib/kpi/status";
import { PhotoThumbs } from "./photo-thumbs";

const scoreStr = (s: number | null) => (s === null ? "" : String(s));

/** Редактор одного пункта карты. Общий для оценки и разбора спора. */
export function ItemScoreRow({
  item,
  value,
  onChange,
  disabled,
  issue,
}: {
  item: ReviewFormItem;
  value: DraftItem;
  onChange: (v: DraftItem) => void;
  disabled?: boolean;
  issue?: IssueCode;
}) {
  const t = useTranslations("kpi");
  const manual = item.source === "manual";
  // Текст поля живёт отдельно: «5» по пути к «50» не должен сбрасывать набранное.
  // Неверный текст хранится в черновике флагом invalid, чтобы форма не отправила последний верный балл.
  const [text, setText] = useState(() => (value.invalid ? value.text ?? "" : scoreStr(value.score)));
  const invalid = value.invalid === true;

  // Балл сменили снаружи (новая форма с сервера) — показываем его. Пока текст неверный, его не трогаем.
  useEffect(() => {
    if (invalid) return;
    setText((cur) => (parseScoreInput(cur) === value.score ? cur : scoreStr(value.score)));
  }, [value.score, invalid]);

  const setScore = (score: number | null) => {
    setText(scoreStr(score));
    onChange(pickScore(value, score));
  };

  const onText = (raw: string) => {
    setText(raw);
    const next = scoreTextChange(value, raw);
    if (next) onChange(next);
  };

  // Балл исправили на 100, а заметка осталась от прежнего балла: сами не очищаем, подсказываем (сравнение с сохранённым пунктом).
  const staleNote = staleNoteHint(item.score, value.score, item.note ?? "", value.note);

  return (
    <div className={cn("space-y-3 rounded-md border p-3", issue && "border-destructive")}>
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="font-medium">{item.title_ru}</span>
          <span className="text-xs text-muted-foreground">{manual ? t("common.itemScore.required") : t(SOURCE_LABEL_KEY[item.source])}</span>
        </div>
        {item.hint_ru && <p className="text-xs text-muted-foreground">{item.hint_ru}</p>}
      </div>

      <div className="flex items-start gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-5 gap-2">
          {SCORE_BUTTONS.map((s) => (
            <Button
              key={s}
              type="button"
              className="h-11 px-0"
              variant={value.score === s ? "default" : "outline"}
              aria-pressed={value.score === s}
              disabled={disabled}
              onClick={() => setScore(s)}
            >
              {s}
            </Button>
          ))}
        </div>
        <div className="w-20 shrink-0">
          <Input
            value={text}
            onChange={(e) => onText(e.target.value)}
            inputMode="numeric"
            aria-label={t("common.itemScore.scoreAria", { title: item.title_ru })}
            aria-invalid={invalid}
            disabled={disabled}
            className="h-11"
          />
        </div>
      </div>
      {invalid && issue !== "bad_score_text" && <p className="text-xs text-destructive">{issueText({ code: "bad_score_text" }, 0, t)}</p>}

      {!manual && (
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setScore(null)}>
          {t("common.itemScore.noData")}
        </Button>
      )}

      {item.suggestion && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            {t("common.itemScore.suggestion", { score: item.suggestion.score, basis: item.suggestion.basis })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => setScore(item.suggestion!.score)}
          >
            {t("common.itemScore.accept")}
          </Button>
        </div>
      )}

      {item.violation_hint !== null && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              {t("common.itemScore.violations", { count: item.violations.length, hint: item.violation_hint })}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => setScore(item.violation_hint)}
            >
              {t("common.itemScore.setHint", { hint: item.violation_hint })}
            </Button>
          </div>
          {item.violations.length > 0 && (
            <ul className="space-y-2">
              {item.violations.map((v) => (
                <li key={v.id} className="space-y-1 rounded bg-muted/50 p-2">
                  <div className="text-xs text-muted-foreground">{formatTashkent(v.occurred_at)}</div>
                  <div>{v.comment}</div>
                  <PhotoThumbs photos={v.photos} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Textarea
        rows={2}
        value={value.note}
        disabled={disabled}
        onChange={(e) => onChange({ ...value, note: e.target.value })}
        aria-label={t("common.itemScore.noteAria", { title: item.title_ru })}
        placeholder={item.suggestion ? t("common.itemScore.notePlaceholderSuggestion") : t("common.itemScore.notePlaceholder")}
      />
      {staleNote && !invalid && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
            {t("common.itemScore.staleNote")}
          </p>
          <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onChange({ ...value, note: "" })}>
            {t("common.itemScore.deleteNote")}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("common.itemScore.noteVisible")}</p>

      {issue && (
        <p role="alert" className="text-sm text-destructive">
          {issueText({ code: issue }, 0, t)}
        </p>
      )}
    </div>
  );
}
