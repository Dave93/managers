"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Input } from "@components/ui/input";
import { Badge } from "@components/ui/badge";

// Редактор поисковых слов роли.
//
// Поле заводится ровно под один сценарий: кадровик обнаружил, что кого-то не
// находит, и дописывает слово, которым эту работу называют в жизни. Поэтому
// здесь нет ни автодополнения, ни справочника допустимых слов — только список,
// в который добавляют и из которого удаляют.
//
// Разделители Enter и запятая: запятая привычнее, но её же содержат некоторые
// написания («салатчица+мойка» не содержит, а вот перечисление через запятую
// кадровик наберёт наверняка). Пробел разделителем НЕ является — синонимы
// бывают из двух слов («универсал повар», «стажер повар»), и это как раз те
// написания, которые канон и потерял.
export default function SynonymsInput({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const words = raw
      .split(",")
      .map((w) => w.trim().replace(/\s+/g, " "))
      .filter(Boolean);
    if (!words.length) return;
    const seen = new Set(value.map((w) => w.toLowerCase().replace(/ё/g, "е")));
    const next = [...value];
    for (const w of words) {
      const key = w.toLowerCase().replace(/ё/g, "е");
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(w);
    }
    onChange(next);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {value.map((w) => (
          <Badge key={w} variant="secondary" className="gap-1 font-normal">
            {w}
            <button
              type="button"
              aria-label={w}
              className="opacity-60 hover:opacity-100"
              onClick={() => onChange(value.filter((x) => x !== w))}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            // Enter внутри формы иначе отправит её, не добавив слово.
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        // Уход из поля с недописанным словом — самая частая потеря: человек
        // набрал «салатчица» и нажал «Сохранить», минуя Enter.
        onBlur={() => add(draft)}
      />
    </div>
  );
}
