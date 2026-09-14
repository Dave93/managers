export type FieldOption = { value: string; label_ru: string; label_uz: string };

export type FieldDef = {
  key: string;
  type: "select" | "text";
  required: boolean;
  label_ru: string;
  label_uz: string;
  options?: FieldOption[];
};

export type SchemaResult = { ok: true; schema: FieldDef[] } | { ok: false; errors: string[] };
export type DetailsResult =
  | { ok: true; details: Record<string, string> }
  | { ok: false; errors: string[] };

const KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;
const MAX_TEXT = 2000;

const isStr = (v: unknown): v is string => typeof v === "string";
const filled = (v: unknown): v is string => isStr(v) && v.trim().length > 0;

// Схема типа приходит из админки и уезжает в форму на планшете менеджера.
// Невалидная схема ломает создание заявок в разгар смены, чинить её будет
// некому, поэтому проверка стоит на входе, а не на отрисовке.
export function validateSchema(raw: unknown): SchemaResult {
  const errors: string[] = [];
  if (!Array.isArray(raw)) return { ok: false, errors: ["схема должна быть массивом полей"] };

  const seenKeys = new Set<string>();
  const schema: FieldDef[] = [];

  raw.forEach((item, i) => {
    const where = `поле #${i + 1}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      errors.push(`${where}: не объект`);
      return;
    }
    const f = item as Record<string, unknown>;

    if (!isStr(f.key) || !KEY_RE.test(f.key)) {
      errors.push(`${where}: ключ должен быть snake_case латиницей`);
      return;
    }
    if (seenKeys.has(f.key)) {
      errors.push(`${f.key}: повторяющийся ключ`);
      return;
    }
    seenKeys.add(f.key);

    if (f.type !== "select" && f.type !== "text") {
      errors.push(`${f.key}: тип должен быть select или text`);
      return;
    }
    if (!filled(f.label_ru) || !filled(f.label_uz)) {
      errors.push(`${f.key}: нужны обе подписи, русская и узбекская`);
      return;
    }

    const def: FieldDef = {
      key: f.key,
      type: f.type,
      required: f.required === true,
      label_ru: f.label_ru.trim(),
      label_uz: f.label_uz.trim(),
    };

    if (f.type === "select") {
      if (!Array.isArray(f.options) || f.options.length === 0) {
        errors.push(`${f.key}: у select должен быть хотя бы один вариант`);
        return;
      }
      const seenValues = new Set<string>();
      const options: FieldOption[] = [];
      for (const o of f.options as Record<string, unknown>[]) {
        if (!filled(o?.value) || !filled(o?.label_ru) || !filled(o?.label_uz)) {
          errors.push(`${f.key}: у варианта нужны value и обе подписи`);
          return;
        }
        if (seenValues.has(o.value)) {
          errors.push(`${f.key}: повторяющееся значение варианта ${o.value}`);
          return;
        }
        seenValues.add(o.value);
        options.push({
          value: o.value.trim(),
          label_ru: o.label_ru.trim(),
          label_uz: o.label_uz.trim(),
        });
      }
      def.options = options;
    }

    schema.push(def);
  });

  return errors.length ? { ok: false, errors } : { ok: true, schema };
}

export function validateDetails(schema: FieldDef[], raw: unknown): DetailsResult {
  const errors: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ["значения полей должны быть объектом"] };
  }
  const input = raw as Record<string, unknown>;
  const known = new Set(schema.map((f) => f.key));

  for (const key of Object.keys(input)) {
    if (!known.has(key)) errors.push(`${key}: поля нет в схеме типа`);
  }

  const details: Record<string, string> = {};
  for (const f of schema) {
    const value = input[f.key];

    // Check if key is absent or has empty string value
    const isAbsent = !Object.prototype.hasOwnProperty.call(input, f.key);
    const isEmpty = isStr(value) && value.trim().length === 0;

    if (isAbsent || isEmpty) {
      if (f.required) errors.push(`${f.key}: обязательное поле`);
      continue;
    }

    // Key is present; check if it's a string
    if (!isStr(value)) {
      errors.push(`${f.key}: значение должно быть строкой`);
      continue;
    }

    const trimmed = value.trim();
    if (f.type === "select") {
      if (!f.options?.some((o) => o.value === trimmed)) {
        errors.push(`${f.key}: значение вне списка вариантов`);
        continue;
      }
    } else if (trimmed.length > MAX_TEXT) {
      errors.push(`${f.key}: длиннее ${MAX_TEXT} символов`);
      continue;
    }
    details[f.key] = trimmed;
  }

  return errors.length ? { ok: false, errors } : { ok: true, details };
}
