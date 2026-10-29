"use client";

// Редактор схемы полей типа заявки. Голого JSON здесь нет намеренно: схему
// правят формой, а правила (rules.ts) повторяют серверный validateSchema, так
// что сломанная схема до сервера не доходит, а если дойдёт, 422 не
// противоречит подсказке под полем.
//
// Редактор управляемый: черновик и список проблем живут в панели типа, потому
// что сводка ошибок нужна и кнопке «Сохранить» в подвале, и подтверждению.
// Порядок полей меняют кнопками «выше» и «ниже»: перетаскивание не нужно,
// кнопки проверяемы и не трогают ключи.

import { useId } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { cn } from "@admin/lib/utils";
import { Button } from "@components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { Switch } from "@components/ui/switch";

import {
  blankField,
  blankOption,
  type FieldDraft,
  type Issue,
  type IssueTarget,
  type OptionDraft,
} from "./rules";

// Переключатель на два-три значения: тот же вид, что у выбора языка в панели
// исполнителя.
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  disabled,
  labelledBy,
}: {
  value: T;
  onChange: (v: T) => void;
  options: readonly { value: T; label: string }[];
  disabled?: boolean;
  labelledBy: string;
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="inline-flex rounded-md border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[5px] px-3 py-1 text-[13px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50",
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const FIELD_TYPES = [
  { value: "select", label: "Список" },
  { value: "text", label: "Текст" },
] as const;

function Problem({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-snug text-destructive">{children}</p>;
}

// Первая проблема нужной цели; остальные у той же цели повторяли бы одно и то же.
const problemFor = (issues: Issue[], target: IssueTarget, optionUid?: string) =>
  issues.find((i) => i.target === target && i.optionUid === optionUid);

function OptionRow({
  index,
  fieldNo,
  option,
  issues,
  disabled,
  onChange,
  onRemove,
}: {
  index: number;
  fieldNo: number;
  option: OptionDraft;
  issues: Issue[];
  disabled: boolean;
  onChange: (patch: Partial<OptionDraft>) => void;
  onRemove: () => void;
}) {
  const bad = (t: IssueTarget) => problemFor(issues, t, option.uid);
  const who = `Поле ${fieldNo}, вариант ${index + 1}`;
  const first = issues.filter((i) => i.optionUid === option.uid)[0];
  return (
    <li className="space-y-1">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Input
          value={option.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder="Значение"
          aria-label={`${who}: значение`}
          aria-invalid={Boolean(bad("option_value"))}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          className="font-mono text-[13px] sm:col-start-1 sm:row-start-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-9 shrink-0 p-0 sm:col-start-4 sm:row-start-1"
          aria-label={`${who}: удалить`}
          onClick={onRemove}
          disabled={disabled}
        >
          <Trash2 className="size-4" />
        </Button>
        <Input
          value={option.label_ru}
          onChange={(e) => onChange({ label_ru: e.target.value })}
          placeholder="Подпись по-русски"
          aria-label={`${who}: подпись по-русски`}
          aria-invalid={Boolean(bad("option_label_ru"))}
          autoComplete="off"
          disabled={disabled}
          className="col-span-2 sm:col-span-1 sm:col-start-2 sm:row-start-1"
        />
        <Input
          value={option.label_uz}
          onChange={(e) => onChange({ label_uz: e.target.value })}
          placeholder="Подпись по-узбекски"
          aria-label={`${who}: подпись по-узбекски`}
          aria-invalid={Boolean(bad("option_label_uz"))}
          autoComplete="off"
          disabled={disabled}
          className="col-span-2 sm:col-span-1 sm:col-start-3 sm:row-start-1"
        />
      </div>
      {first && <Problem>{first.message}</Problem>}
    </li>
  );
}

function FieldCard({
  index,
  total,
  field,
  was,
  issues,
  disabled,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  total: number;
  field: FieldDraft;
  // Каким поле было при открытии панели; null у только что добавленного.
  was: FieldDraft | null;
  issues: Issue[];
  disabled: boolean;
  onChange: (patch: Partial<FieldDraft>) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const base = useId();
  const ids = {
    key: `${base}-key`,
    type: `${base}-type`,
    required: `${base}-req`,
    ru: `${base}-ru`,
    uz: `${base}-uz`,
  };
  const no = index + 1;
  // Ошибки показываем у поля, которого уже касались; на пустой свежей карточке
  // они появятся с первым вводом. Кнопка «Сохранить» от этого не оживает: она
  // смотрит на все проблемы.
  const shown = field.touched ? issues : [];
  const keyProblem = problemFor(shown, "key");
  const ruProblem = problemFor(shown, "label_ru");
  const uzProblem = problemFor(shown, "label_uz");
  const optionsProblem = problemFor(shown, "options");
  const renamedFrom = was && was.key !== "" && was.key !== field.key ? was.key : null;

  return (
    <li className="space-y-3 rounded-lg border bg-card p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold">
          Поле {no}
          {!was && (
            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              новое
            </span>
          )}
        </p>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={`Поле ${no}: выше`}
            onClick={() => onMove(-1)}
            disabled={disabled || index === 0}
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            aria-label={`Поле ${no}: ниже`}
            onClick={() => onMove(1)}
            disabled={disabled || index === total - 1}
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0 text-destructive hover:text-destructive"
            aria-label={`Поле ${no}: удалить`}
            onClick={onRemove}
            disabled={disabled}
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="space-y-1.5">
          <Label htmlFor={ids.key}>Ключ</Label>
          <Input
            id={ids.key}
            value={field.key}
            onChange={(e) => onChange({ key: e.target.value })}
            aria-invalid={Boolean(keyProblem)}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            placeholder="например, tv_place"
            className="font-mono text-[13px]"
          />
          {keyProblem ? (
            <Problem>{keyProblem.message}</Problem>
          ) : (
            <p className="text-[12px] leading-snug text-muted-foreground">
              Внутреннее имя поля: по нему значение хранится в заявке.
            </p>
          )}
          {renamedFrom && (
            <p className="text-[12px] leading-snug text-amber-700 dark:text-amber-400">
              Было «{renamedFrom}». Старые заявки хранят значение под прежним ключом и после
              сохранения покажут его без подписи.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label id={ids.type}>Тип поля</Label>
          <div>
            <Segmented
              value={field.type}
              onChange={(type) => onChange({ type })}
              options={FIELD_TYPES}
              disabled={disabled}
              labelledBy={ids.type}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
        <Label htmlFor={ids.required}>Обязательное поле</Label>
        <Switch
          id={ids.required}
          checked={field.required}
          onCheckedChange={(required) => onChange({ required })}
          disabled={disabled}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={ids.ru}>Подпись по-русски</Label>
          <Input
            id={ids.ru}
            value={field.label_ru}
            onChange={(e) => onChange({ label_ru: e.target.value })}
            aria-invalid={Boolean(ruProblem)}
            autoComplete="off"
            disabled={disabled}
          />
          {ruProblem && <Problem>{ruProblem.message}</Problem>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.uz}>Подпись по-узбекски</Label>
          <Input
            id={ids.uz}
            value={field.label_uz}
            onChange={(e) => onChange({ label_uz: e.target.value })}
            aria-invalid={Boolean(uzProblem)}
            autoComplete="off"
            disabled={disabled}
          />
          {uzProblem && <Problem>{uzProblem.message}</Problem>}
        </div>
      </div>

      {field.type === "select" && (
        <div className="space-y-2 rounded-md bg-muted/40 p-3">
          <p className="text-[12.5px] font-medium">Варианты</p>
          {field.options.length > 0 && (
            <ul className="space-y-2.5">
              {field.options.map((o, oi) => (
                <OptionRow
                  key={o.uid}
                  index={oi}
                  fieldNo={no}
                  option={o}
                  issues={shown}
                  disabled={disabled}
                  onChange={(patch) =>
                    onChange({
                      options: field.options.map((x) => (x.uid === o.uid ? { ...x, ...patch } : x)),
                    })
                  }
                  onRemove={() =>
                    onChange({ options: field.options.filter((x) => x.uid !== o.uid) })
                  }
                />
              ))}
            </ul>
          )}
          {optionsProblem && <Problem>{optionsProblem.message}</Problem>}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange({ options: [...field.options, blankOption()] })}
            disabled={disabled}
          >
            <Plus className="size-3.5" />
            Добавить вариант
          </Button>
        </div>
      )}
    </li>
  );
}

export function FieldsEditor({
  drafts,
  initial,
  issues,
  disabled,
  onChange,
}: {
  drafts: FieldDraft[];
  // Поля в том виде, как были при открытии панели, по uid.
  initial: ReadonlyMap<string, FieldDraft>;
  issues: Issue[];
  disabled: boolean;
  onChange: (next: FieldDraft[]) => void;
}) {
  const patch = (uid: string, p: Partial<FieldDraft>) =>
    onChange(drafts.map((d) => (d.uid === uid ? { ...d, ...p, touched: true } : d)));
  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= drafts.length) return;
    const next = drafts.slice();
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  };

  return (
    <section aria-label="Поля заявки" className="space-y-3">
      <div>
        <h3 className="text-[13px] font-semibold">Поля заявки</h3>
        <p className="text-[12px] leading-snug text-muted-foreground">
          Это то, что менеджер заполняет на планшете. Порядок здесь — порядок на экране.
        </p>
      </div>
      {drafts.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[12.5px] text-muted-foreground">
          Полей нет: заявка будет только с описанием и фотографиями.
        </p>
      ) : (
        <ul className="space-y-3">
          {drafts.map((d, i) => (
            <FieldCard
              key={d.uid}
              index={i}
              total={drafts.length}
              field={d}
              was={initial.get(d.uid) ?? null}
              issues={issues.filter((x) => x.fieldUid === d.uid)}
              disabled={disabled}
              onChange={(p) => patch(d.uid, p)}
              onMove={(delta) => move(i, delta)}
              onRemove={() => onChange(drafts.filter((x) => x.uid !== d.uid))}
            />
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...drafts, blankField()])}
        disabled={disabled}
      >
        <Plus className="size-3.5" />
        Добавить поле
      </Button>
    </section>
  );
}
