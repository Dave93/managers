// Правила редактора типов заявок. Чистый модуль: ни React, ни запросов, ни
// алиасов вроде @admin, потому что его импортирует и backend-тест
// (backend/src/modules/tickets/schema-parity.test.ts), который гоняет те же
// входы через этот код и через настоящий validateSchema сервера.
//
// Схема полей — единственное место, где битые данные ломают планшет мастера
// посреди смены: сервер её, конечно, проверит повторно и ответит 422, но
// сообщение должно быть понятно ещё в форме, а сохранение не должно уходить,
// пока в схеме есть ошибка. Поэтому правила ниже повторяют
// backend/src/modules/tickets/fields.ts (validateSchema) правило в правило,
// в том же порядке, а текст берут оттуда же дословно.
//
// Что редактор не может породить, поэтому здесь не проверяется: схема не
// массив, элемент не объект, ключ не строка, тип не select/text. В черновике
// тип — переключатель из двух значений, а остальное — строки в полях ввода.

export type SchemaOption = { value: string; label_ru: string; label_uz: string };
export type SchemaField = {
  key: string;
  type: "select" | "text";
  required: boolean;
  label_ru: string;
  label_uz: string;
  options?: SchemaOption[];
};

// ---------------------------------------------------------------------------
// черновик схемы
// ---------------------------------------------------------------------------

// uid нужен как React-ключ строки и как «личность» поля между правками: ключ
// поля редактируется, и если взять его в key, поле ввода пересоздавалось бы на
// каждую букву, а два совпавших ключа в момент набора столкнулись бы. По uid
// же сравнивается и «что стало с полем» (переименовано, удалено).
export type OptionDraft = { uid: string; value: string; label_ru: string; label_uz: string };
export type FieldDraft = {
  uid: string;
  key: string;
  type: "select" | "text";
  required: boolean;
  label_ru: string;
  label_uz: string;
  // Варианты живут и у text-поля: если переключить тип туда и обратно, набранное
  // не теряется. В схему для сервера они при этом не попадают (см. toSchema).
  options: OptionDraft[];
  // Ошибки показываем у поля, которого человек уже касался. Загруженные из
  // базы поля считаются тронутыми: если сохранённая схема вдруг не проходит
  // правила, это должно быть видно сразу.
  touched: boolean;
};

let uidCounter = 0;
export const nextUid = () => `d${++uidCounter}`;

const str = (v: unknown) => (typeof v === "string" ? v : "");

export const blankOption = (): OptionDraft => ({
  uid: nextUid(),
  value: "",
  label_ru: "",
  label_uz: "",
});

export const blankField = (): FieldDraft => ({
  uid: nextUid(),
  key: "",
  type: "text",
  required: false,
  label_ru: "",
  label_uz: "",
  options: [],
  touched: false,
});

// Схема из базы -> черновик. Читает защитно: сервер хранит только то, что
// прошло validateSchema, но строку могли вставить руками.
export function toDrafts(raw: unknown): FieldDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item): FieldDraft => {
    const f = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const options = Array.isArray(f.options)
      ? f.options.map((o): OptionDraft => {
          const x = (typeof o === "object" && o !== null ? o : {}) as Record<string, unknown>;
          return {
            uid: nextUid(),
            value: str(x.value),
            label_ru: str(x.label_ru),
            label_uz: str(x.label_uz),
          };
        })
      : [];
    return {
      uid: nextUid(),
      key: str(f.key),
      type: f.type === "select" ? "select" : "text",
      required: f.required === true,
      label_ru: str(f.label_ru),
      label_uz: str(f.label_uz),
      options,
      touched: true,
    };
  });
}

// Черновик -> то, что уходит на сервер. Подписи и значения вариантов обрезаются
// так же, как их обрежет сервер, варианты у text-поля отбрасываются, как на
// сервере. Ключ не обрезается: сервер его не обрезает, а пробел в ключе — ошибка.
export function toSchema(drafts: FieldDraft[]): SchemaField[] {
  return drafts.map((d) => {
    const def: SchemaField = {
      key: d.key,
      type: d.type,
      required: d.required,
      label_ru: d.label_ru.trim(),
      label_uz: d.label_uz.trim(),
    };
    if (d.type === "select") {
      def.options = d.options.map((o) => ({
        value: o.value.trim(),
        label_ru: o.label_ru.trim(),
        label_uz: o.label_uz.trim(),
      }));
    }
    return def;
  });
}

// Две схемы равны, если после одного и того же приведения совпадают
// побуквенно. «Без изменений» определяется так, а не сравнением со строкой из
// базы: порядок свойств у jsonb другой, и пустой options у text-поля не должен
// делать нетронутую схему «изменённой».
export const schemaSignature = (drafts: FieldDraft[]) => JSON.stringify(toSchema(drafts));

// ---------------------------------------------------------------------------
// проверка схемы (зеркало fields.ts: validateSchema)
// ---------------------------------------------------------------------------

export const KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;
const filled = (v: string) => v.trim().length > 0;

// Формулировки сервера дословно (после префикса «поле #N: » или «ключ: »).
// Сообщение в форме начинается с них, так что 422 не может противоречить
// подсказке под полем.
export const CLAUSE = {
  key: "ключ должен быть snake_case латиницей",
  dupKey: "повторяющийся ключ",
  labels: "нужны обе подписи, русская и узбекская",
  selectEmpty: "у select должен быть хотя бы один вариант",
  optionIncomplete: "у варианта нужны value и обе подписи",
  optionDup: (value: string) => `повторяющееся значение варианта ${value}`,
} as const;

export type IssueCode = "key_format" | "key_dup" | "label_missing" | "select_empty" | "option_incomplete" | "option_dup";

export type IssueTarget =
  | "key"
  | "label_ru"
  | "label_uz"
  | "options"
  | "option_value"
  | "option_label_ru"
  | "option_label_uz";

export type Issue = {
  fieldUid: string;
  fieldIndex: number;
  // Метка поля для сводки: ключ, если он корректен, иначе «поле #N» — как у сервера.
  where: string;
  code: IssueCode;
  target: IssueTarget;
  optionUid?: string;
  // Формулировка сервера без префикса.
  clause: string;
  // Текст для человека: клауза с заглавной буквы плюс, где надо, подсказка.
  message: string;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const KEY_HINT =
  " Начинайте со строчной латинской буквы, дальше буквы a–z, цифры и «_», всего не больше 31 знака.";

// Все проблемы, а не первая: так человек видит их разом. Порядок внутри поля —
// порядок проверок сервера, поэтому первая проблема поля — та, что назвал бы
// сервер. Ключ без формата не регистрируется как занятый (как на сервере), и
// дубль приписывается более позднему полю.
export function validateDrafts(drafts: FieldDraft[]): Issue[] {
  const issues: Issue[] = [];
  const seenKeys = new Set<string>();

  drafts.forEach((f, i) => {
    const keyOk = KEY_RE.test(f.key);
    const where = keyOk ? f.key : `поле #${i + 1}`;
    const push = (
      code: IssueCode,
      target: IssueTarget,
      clause: string,
      extra?: { optionUid?: string; hint?: string }
    ) =>
      issues.push({
        fieldUid: f.uid,
        fieldIndex: i,
        where,
        code,
        target,
        optionUid: extra?.optionUid,
        clause,
        message: `${cap(clause)}.${extra?.hint ?? ""}`,
      });

    if (!keyOk) {
      push("key_format", "key", CLAUSE.key, { hint: KEY_HINT });
    } else if (seenKeys.has(f.key)) {
      push("key_dup", "key", CLAUSE.dupKey);
    } else {
      seenKeys.add(f.key);
    }

    if (!filled(f.label_ru)) push("label_missing", "label_ru", CLAUSE.labels);
    if (!filled(f.label_uz)) push("label_missing", "label_uz", CLAUSE.labels);

    if (f.type !== "select") return;
    if (f.options.length === 0) {
      push("select_empty", "options", CLAUSE.selectEmpty);
      return;
    }
    // Дубли ищем по обрезанному значению, как и сервер (fields.ts): в схему
    // пишется именно оно, и «a» с « a» дали бы два одинаковых варианта.
    const seenValues = new Set<string>();
    for (const o of f.options) {
      const bad = [
        !filled(o.value) && "option_value",
        !filled(o.label_ru) && "option_label_ru",
        !filled(o.label_uz) && "option_label_uz",
      ].filter(Boolean) as IssueTarget[];
      if (bad.length > 0) {
        for (const target of bad) {
          push("option_incomplete", target, CLAUSE.optionIncomplete, { optionUid: o.uid });
        }
        continue;
      }
      const v = o.value.trim();
      if (seenValues.has(v)) {
        push("option_dup", "option_value", CLAUSE.optionDup(v), { optionUid: o.uid });
      } else {
        seenValues.add(v);
      }
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// что осиротят правки (для предупреждения перед сохранением)
// ---------------------------------------------------------------------------

export type OrphanRisks = {
  // Поле удалено: значения в старых заявках остаются без подписи.
  removed: string[];
  // Ключ переименован: старые заявки хранят значение под прежним ключом.
  renamed: { from: string; to: string }[];
  // Варианты select убраны или переименованы, либо select стал text: карточка
  // покажет в старых заявках сам код значения вместо подписи.
  optionLoss: { key: string; values: string[]; toText: boolean }[];
  // Ключ, который был у одного поля, а стал у другого (удалили x и переименовали
  // y в x; поменяли ключи местами; завели новое поле со старым ключом). Хуже
  // остальных: пометки «поле удалено» не будет, ключ ведь существует, и
  // старые значения отрисуются под подписью чужого поля.
  reused: string[];
};

export const noRisks = (r: OrphanRisks) =>
  r.removed.length === 0 &&
  r.renamed.length === 0 &&
  r.optionLoss.length === 0 &&
  r.reused.length === 0;

// Сравнение идёт с моментом открытия панели (initial), а не со строкой списка:
// список перезапрашивается под руками. Совпадение полей — по uid.
export function orphanRisks(initial: FieldDraft[], current: FieldDraft[]): OrphanRisks {
  const out: OrphanRisks = { removed: [], renamed: [], optionLoss: [], reused: [] };
  const now = new Map(current.map((f) => [f.uid, f]));
  // Сравнение по uid ловит удаление и переименование, но не переиспользование
  // ключа, поэтому итоговые ключи сверяются с исходными ещё и как множество.
  const owner = new Map(initial.filter((f) => f.key !== "").map((f) => [f.key, f.uid]));
  for (const cur of current) {
    const was = owner.get(cur.key);
    if (was !== undefined && was !== cur.uid && !out.reused.includes(cur.key)) out.reused.push(cur.key);
  }
  for (const was of initial) {
    // Без ключа значений в заявках быть не могло.
    if (was.key === "") continue;
    const cur = now.get(was.uid);
    if (!cur) {
      out.removed.push(was.key);
      continue;
    }
    if (cur.key !== was.key) {
      out.renamed.push({ from: was.key, to: cur.key });
      continue;
    }
    if (was.type !== "select") continue;
    if (cur.type !== "select") {
      out.optionLoss.push({ key: was.key, values: [], toText: true });
      continue;
    }
    const keep = new Set(cur.options.map((o) => o.value.trim()));
    const lost = [
      ...new Set(was.options.map((o) => o.value.trim()).filter((v) => v !== "" && !keep.has(v))),
    ];
    if (lost.length > 0) out.optionLoss.push({ key: was.key, values: lost, toText: false });
  }
  return out;
}

// Смена префикса у существующего типа. Номер заявки нигде не хранится, он
// собирается из ТЕКУЩЕГО префикса типа при каждом показе (карточка, список,
// уведомления в Telegram), так что смена перенумеровывает все заявки типа,
// и старые тоже.
export type PrefixChange = { from: string; to: string };

export function prefixChange(
  mode: "create" | "edit",
  was: string,
  now: string
): PrefixChange | null {
  if (mode !== "edit") return null;
  const from = was.trim();
  const to = now.trim();
  return from !== to ? { from, to } : null;
}

// Нужно ли подтверждение перед сохранением. Число заявок сюда не входит
// намеренно: у роли с tickets.list_all оно полное, но без этого права GET
// /tickets считает только филиалы сессии, и «ноль» у учётки с выданными
// терминалами не значит «заявок нет нигде». Есть риск — спрашиваем.
export const needsConfirmation = (
  mode: "create" | "edit",
  risks: OrphanRisks,
  prefix: PrefixChange | null
) => mode === "edit" && (!noRisks(risks) || prefix !== null);

// ---------------------------------------------------------------------------
// остальные поля формы типа
// ---------------------------------------------------------------------------

// Сервер эти значения не проверяет вовсе (только что они строки), а потом их
// ловит Postgres: varchar(50) у code и icon, varchar(5) у number_prefix,
// varchar(255) у названий, integer у sort. Переполнение выглядело бы сырой 500,
// поэтому границы стоят здесь.
export const LIMITS = { code: 50, prefix: 5, name: 255, icon: 50, sortAbs: 2147483647 } as const;

// Те же snake_case-правила, что у seed-типов (ad_tv, cameras); сервер формата
// кода не требует, так что это правило только клиента, и только для нового кода.
export const CODE_RE = /^[a-z][a-z0-9_]{0,49}$/;
export const PREFIX_RE = /^[A-Z0-9]+$/;

export type TypeFormValues = {
  code: string;
  number_prefix: string;
  name_ru: string;
  name_uz: string;
  icon: string;
  sort: string;
};
export type TypeFormErrors = Partial<Record<keyof TypeFormValues, string>>;

export function validateTypeForm(
  v: TypeFormValues,
  mode: "create" | "edit",
  initial: TypeFormValues
): TypeFormErrors {
  const e: TypeFormErrors = {};

  for (const k of ["name_ru", "name_uz"] as const) {
    const t = v[k].trim();
    if (t === "") e[k] = "Название обязательно.";
    else if (t.length > LIMITS.name) e[k] = `Не длиннее ${LIMITS.name} знаков.`;
  }

  if (mode === "create") {
    const c = v.code.trim();
    if (c === "") e.code = "Код обязателен.";
    else if (!CODE_RE.test(c)) {
      e.code = `Код: латиница в snake_case (ad_tv, cameras), начинается с буквы, не длиннее ${LIMITS.code} знаков.`;
    }
  }

  const p = v.number_prefix.trim();
  if (p === "") e.number_prefix = "Префикс обязателен.";
  else if (p.length > LIMITS.prefix) e.number_prefix = `Не длиннее ${LIMITS.prefix} знаков.`;
  // Формат проверяем, только когда префикс новый или правится: уже сохранённый
  // нестандартный префикс не должен блокировать правку соседних полей.
  else if ((mode === "create" || p !== initial.number_prefix.trim()) && !PREFIX_RE.test(p)) {
    e.number_prefix = "Только заглавные латинские буквы и цифры.";
  }

  if (v.icon.trim().length > LIMITS.icon) e.icon = `Не длиннее ${LIMITS.icon} знаков.`;

  const s = v.sort.trim();
  if (!/^-?\d+$/.test(s) || Math.abs(Number(s)) > LIMITS.sortAbs) {
    e.sort = "Целое число, например 0 или 10.";
  }
  return e;
}

// ---------------------------------------------------------------------------
// что уходит на сервер
// ---------------------------------------------------------------------------

// Состояние формы целиком. Сборка тел запросов вынесена сюда, а не живёт в
// обработчике: что именно отправляется (а что нет) — самое рискованное место
// панели, и проверяется оно без браузера.
export type FormState = {
  values: TypeFormValues;
  kind: "external" | "staff";
  // "" — фирма не выбрана.
  contractorId: string;
  active: boolean;
  fields: FieldDraft[];
};

export type CreateBody = {
  code: string;
  number_prefix: string;
  name_ru: string;
  name_uz: string;
  executor_kind: "external" | "staff";
  fields_schema: SchemaField[];
  active: boolean;
  sort: number;
  icon?: string;
  contractor_id?: string;
};

// Поля, которых нет в теле, сервер не трогает. Нет здесь code и executor_kind
// (PUT их не принимает) и requires_cost (экран его не ведёт).
export type UpdatePatch = Partial<Omit<CreateBody, "code" | "executor_kind">>;

const INT_RE = /^-?\d+$/;

export function buildCreateBody(s: FormState): CreateBody {
  const v = s.values;
  const icon = v.icon.trim();
  return {
    code: v.code.trim(),
    number_prefix: v.number_prefix.trim(),
    name_ru: v.name_ru.trim(),
    name_uz: v.name_uz.trim(),
    executor_kind: s.kind,
    fields_schema: toSchema(s.fields),
    active: s.active,
    sort: Number(v.sort.trim()),
    ...(icon ? { icon } : {}),
    // Фирма есть только у external; у staff сервер на неё отвечает 422.
    ...(s.kind === "external" && s.contractorId ? { contractor_id: s.contractorId } : {}),
  };
}

// Только то, что изменилось. Схема уходит лишь если она отличается после
// приведения: нетронутая не переписывается, а значит и не может пострадать.
// Фирму нельзя стереть (PUT не принимает ни null, ни пустую строку), поэтому
// пустая фирма в патч не попадает никогда; значок стирается пустой строкой.
export function buildUpdatePatch(was: FormState, now: FormState): UpdatePatch {
  const patch: UpdatePatch = {};
  const w = was.values;
  const n = now.values;
  if (n.number_prefix.trim() !== w.number_prefix.trim()) patch.number_prefix = n.number_prefix.trim();
  if (n.name_ru.trim() !== w.name_ru.trim()) patch.name_ru = n.name_ru.trim();
  if (n.name_uz.trim() !== w.name_uz.trim()) patch.name_uz = n.name_uz.trim();
  if (n.icon.trim() !== w.icon.trim()) patch.icon = n.icon.trim();
  // Нечисло в sort не отправляется никогда: NaN в JSON стал бы null и 422.
  if (n.sort.trim() !== w.sort.trim() && INT_RE.test(n.sort.trim())) patch.sort = Number(n.sort.trim());
  if (now.active !== was.active) patch.active = now.active;
  if (now.kind === "external" && now.contractorId !== "" && now.contractorId !== was.contractorId) {
    patch.contractor_id = now.contractorId;
  }
  if (schemaSignature(now.fields) !== schemaSignature(was.fields)) {
    patch.fields_schema = toSchema(now.fields);
  }
  return patch;
}
