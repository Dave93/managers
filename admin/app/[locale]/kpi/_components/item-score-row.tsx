"use client";
import React, { useEffect, useState } from "react";
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
  type DraftItem,
  type IssueCode,
} from "@admin/lib/kpi/review-form";
import { SOURCE_LABEL } from "@admin/lib/kpi/status";
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
  const manual = item.source === "manual";
  // Текст поля живёт отдельно: «5» по пути к «50» не должен сбрасывать набранное.
  // Неверный текст хранится в черновике флагом invalid, чтобы форма не отправила последний верный балл.
  const [text, setText] = useState(() => (value.invalid ? value.text ?? "" : scoreStr(value.score)));
  const invalid = value.invalid === true;

  // Балл сменили снаружи (новая форма с сервера) — показываем его. Пока текст неверный, его не трогаем.
  useEffect(() => {
    if (invalid) return;
    setText((t) => (parseScoreInput(t) === value.score ? t : scoreStr(value.score)));
  }, [value.score, invalid]);

  const setScore = (score: number | null) => {
    setText(scoreStr(score));
    onChange(pickScore(value, score));
  };

  const onText = (t: string) => {
    setText(t);
    const next = scoreTextChange(value, t);
    if (next) onChange(next);
  };

  return (
    <div className={cn("space-y-3 rounded-md border p-3", issue && "border-destructive")}>
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2">
          <span className="font-medium">{item.title_ru}</span>
          <span className="text-xs text-muted-foreground">{manual ? "обязательно" : SOURCE_LABEL[item.source]}</span>
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
            aria-label={`Балл: ${item.title_ru}`}
            aria-invalid={invalid}
            disabled={disabled}
            className="h-11"
          />
        </div>
      </div>
      {invalid && issue !== "bad_score_text" && <p className="text-xs text-destructive">Целое от 0 до 100</p>}

      {!manual && (
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setScore(null)}>
          Нет данных
        </Button>
      )}

      {item.suggestion && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            Предложение: {item.suggestion.score} — {item.suggestion.basis}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => setScore(item.suggestion!.score)}
          >
            Принять
          </Button>
        </div>
      )}

      {item.violation_hint !== null && (
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Нарушений за месяц: {item.violations.length}, подсказка: {item.violation_hint}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => setScore(item.violation_hint)}
            >
              Поставить {item.violation_hint}
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
        aria-label={`Заметка: ${item.title_ru}`}
        placeholder={item.suggestion ? "Заметка (обязательна, если балл отличается от предложения или не поставлен)" : "Заметка"}
      />

      {issue && (
        <p role="alert" className="text-sm text-destructive">
          {issueText({ code: issue }, 0)}
        </p>
      )}
    </div>
  );
}
