"use client";

// The bilingual pair: RU and UZ-Latin side by side, in ONE row, sharing ONE
// label. They are one editorial unit — the publish gate refuses the pair, not
// the field — so the form must not let anyone treat the uz column as an
// optional extra hidden behind a language tab.
//
// A half-filled pair is the state that blocks publication, so it is marked the
// moment it happens: amber ring on the empty side plus «нужен перевод» next to
// the label. The same amber shows up on the tree row (LangPips), so the
// signal is recognisable in both places.

import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { Textarea } from "@components/ui/textarea";
import { cn } from "@admin/lib/utils";

const LANG_LABEL: Record<"ru" | "uz", string> = {
  ru: "RU · русский",
  uz: "UZ · o‘zbekcha",
};

function Column({
  lang,
  value,
  onChange,
  onBlur,
  multiline,
  rows,
  disabled,
  needsAttention,
  placeholder,
  id,
}: {
  lang: "ru" | "uz";
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
  needsAttention: boolean;
  placeholder?: string;
  id: string;
}) {
  const control = cn(
    "transition-[box-shadow,border-color] duration-150",
    needsAttention &&
      "border-amber-400 ring-2 ring-amber-200/70 dark:border-amber-600 dark:ring-amber-900/50"
  );
  return (
    <div className="space-y-1">
      <label
        htmlFor={id}
        className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        {LANG_LABEL[lang]}
      </label>
      {multiline ? (
        <Textarea
          id={id}
          rows={rows ?? 3}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={control}
        />
      ) : (
        <Input
          id={id}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className={control}
        />
      )}
    </div>
  );
}

export function BilingualPair({
  form,
  label,
  hint,
  nameRu,
  nameUz,
  multiline,
  rows,
  disabled,
  placeholderRu,
  placeholderUz,
}: {
  form: any;
  label: string;
  hint?: string;
  nameRu: string;
  nameUz: string;
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
  placeholderRu?: string;
  placeholderUz?: string;
}) {
  return (
    <form.Subscribe
      selector={(s: any) => [
        String(s.values?.[nameRu] ?? ""),
        String(s.values?.[nameUz] ?? ""),
      ]}
    >
      {([ru, uz]: [string, string]) => {
        const ruFilled = ru.trim().length > 0;
        const uzFilled = uz.trim().length > 0;
        // Only nag once at least one side has content: an untouched pair is
        // "not written yet", a half-filled one is "will refuse to publish".
        const half = ruFilled !== uzFilled;
        return (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <Label className="text-[13px] font-medium">{label}</Label>
              {half && !disabled && (
                <span className="shrink-0 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  нужен перевод {ruFilled ? "на UZ" : "на RU"}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <form.Field name={nameRu}>
                {(field: any) => (
                  <Column
                    id={`f-${nameRu}`}
                    lang="ru"
                    value={String(field.state.value ?? "")}
                    onChange={field.handleChange}
                    onBlur={field.handleBlur}
                    multiline={multiline}
                    rows={rows}
                    disabled={disabled}
                    placeholder={placeholderRu}
                    needsAttention={half && !ruFilled}
                  />
                )}
              </form.Field>
              <form.Field name={nameUz}>
                {(field: any) => (
                  <Column
                    id={`f-${nameUz}`}
                    lang="uz"
                    value={String(field.state.value ?? "")}
                    onChange={field.handleChange}
                    onBlur={field.handleBlur}
                    multiline={multiline}
                    rows={rows}
                    disabled={disabled}
                    placeholder={placeholderUz}
                    needsAttention={half && !uzFilled}
                  />
                )}
              </form.Field>
            </div>
            {hint && (
              <p className="text-[11px] leading-snug text-muted-foreground">
                {hint}
              </p>
            )}
          </div>
        );
      }}
    </form.Subscribe>
  );
}
