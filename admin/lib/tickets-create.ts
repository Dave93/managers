// Логика экрана создания заявки на планшете, не зависящая ни от React, ни от
// браузера, чтобы её можно было проверить `bun test` без DOM: что считать
// недоступным типом, какой филиал уйдёт в запрос, чего не хватает форме, как
// выглядит тело multipart и что делать с фотографией до отправки.
//
// Правила повторяют серверные (backend/src/modules/tickets/controller.ts,
// fields.ts, storage.ts). Если сервер их сменит, lib/tickets-create.test.ts
// сверяет числа с исходником storage.ts, так что расхождение видно сразу.

import type { FieldDef, TicketPriority, TicketTypeRow } from "./tickets-api";
import { detailValue } from "./tickets-details";

// ---------------------------------------------------------------------------
// лимиты
// ---------------------------------------------------------------------------

// MAX_FILES_PER_PHASE и MAX_FILE_BYTES из backend/src/modules/tickets/storage.ts.
// Админка не может импортировать бэкенд (tsconfig исключает ../backend), поэтому
// числа продублированы, а тест их сверяет.
export const MAX_PHOTOS = 5;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
// Для текстов сообщений: число в них берётся из той же константы.
const MAX_PHOTO_MB = MAX_PHOTO_BYTES / (1024 * 1024);
// Дальше только решения клиента: длинная сторона и качество сжатия.
export const MAX_PHOTO_SIDE = 1600;
export const JPEG_QUALITY = 0.85;
// MAX_TEXT из fields.ts: длиннее серверный validateDetails не принимает.
export const MAX_TEXT = 2000;

const ACCEPTED_MIME: readonly string[] = ["image/jpeg", "image/png"];
export const isAcceptedMime = (type: string) => ACCEPTED_MIME.includes(type);

// ---------------------------------------------------------------------------
// типы заявок
// ---------------------------------------------------------------------------

// Ровно условие, по которому сервер отвечает 422 «У типа заявки не выбрана
// подрядная фирма»: external без фирмы. У staff-типа contractor_id пуст
// легально (исполнитель — сотрудник), и такой тип должен оставаться рабочим.
export function lacksContractor(t: Pick<TicketTypeRow, "executor_kind" | "contractor_id">): boolean {
  return t.executor_kind === "external" && !t.contractor_id;
}

export function sortTypes<T extends Pick<TicketTypeRow, "sort" | "name_ru">>(types: readonly T[]): T[] {
  return [...types].sort((a, b) => a.sort - b.sort || a.name_ru.localeCompare(b.name_ru, "ru"));
}

// ---------------------------------------------------------------------------
// филиал
// ---------------------------------------------------------------------------

export type Branch = { id: string; name: string };

// Терминалы сессии из ответа GET /users/me: массив id, снятый при входе. Это
// то, по чему сервер решает, куда сессии можно создавать заявки, поэтому
// решение экрана (сколько филиалов, какой id слать) берётся отсюда, а не из
// базы. Пустой массив значит «не закреплён»: так бывает у офисной роли.
// null — ответ без поля terminals (не массив): это сбой, а не «нет филиалов»,
// иначе устаревший или битый ответ показал бы менеджеру панель «нет привязки».
export function terminalIdsFromMe(me: unknown): string[] | null {
  const raw = (me as { terminals?: unknown } | null | undefined)?.terminals;
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    const id = typeof v === "string" ? v.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// Филиалы экрана: набор определяют ids из сессии, имена берутся из строк
// GET /users_terminals/my_terminals (ниже). Строка из базы, которой нет в
// сессии, не попадает в список: филиал, переназначенный после входа, сервер
// всё равно не примет. Id без имени в базе (удалён, строк нет, соединение
// недоступно) остаётся с подписью «Филиал <начало id>».
export function branchesFromSession(ids: readonly string[], rows: unknown): Branch[] {
  const names = new Map(branchesFromRows(rows).map((b) => [b.id, b.name]));
  const seen = new Set<string>();
  const out: Branch[] = [];
  for (const raw of ids) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: names.get(id) ?? `Филиал ${id.slice(0, 8)}` });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

// Строки GET /users_terminals/my_terminals: {terminal_id, terminals: {...}|null},
// где terminals — левое соединение (null, если филиал удалён). Служит только
// источником имён: набор филиалов задаёт сессия (terminalIdsFromMe).
export function branchesFromRows(rows: unknown): Branch[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const out: Branch[] = [];
  for (const r of rows) {
    const id = String(r?.terminal_id ?? r?.terminals?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = typeof r?.terminals?.name === "string" ? r.terminals.name.trim() : "";
    out.push({ id, name: name || `Филиал ${id.slice(0, 8)}` });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

// Какой филиал уйдёт в запрос. Один закреплённый — он и есть; несколько —
// только явный выбор, который всё ещё есть в списке. Первый по умолчанию не
// подставляется: сервер молча берёт userTerminals[0], и именно эту подмену
// экран обязан убрать.
export function pickBranch(branches: readonly Branch[], chosenId: string | null): string | null {
  if (branches.length === 1) return branches[0].id;
  if (chosenId && branches.some((b) => b.id === chosenId)) return chosenId;
  return null;
}

// ---------------------------------------------------------------------------
// поля схемы
// ---------------------------------------------------------------------------

export type FieldValues = Readonly<Record<string, string>>;

// Запись по ключу схемы без обращения к прототипу: ключ «constructor» легален,
// а `{...v, [key]: x}` и Object.fromEntries создают собственное свойство.
export function setFieldValue(values: FieldValues, key: string, value: string): FieldValues {
  return Object.fromEntries([...Object.entries(values).filter(([k]) => k !== key), [key, value]]);
}

export type FieldState = "empty" | "invalid" | "ok";

// empty: нечего отправлять. invalid: значение есть, но сервер его отвергнет
// (вариант исчез из схемы, текст длиннее 2000). ok: уйдёт в details.
// Вариант, исчезший из схемы у НЕобязательного select, не блокирует отправку:
// ключ просто не уходит, и сервер принимает запрос без него. У обязательного
// поля это остаётся invalid: значение нужно выбрать заново.
export function fieldState(f: FieldDef, values: FieldValues): FieldState {
  const raw = detailValue(values, f.key);
  if (typeof raw !== "string" || raw.trim() === "") return "empty";
  const v = raw.trim();
  if (f.type === "select") {
    if (f.options?.some((o) => o.value === v)) return "ok";
    return f.required ? "invalid" : "empty";
  }
  return v.length > MAX_TEXT ? "invalid" : "ok";
}

// details для запроса: только ключи текущей схемы, значения обрезаны, пустые
// и негодные опущены. Ключ, которого в схеме уже нет, не уйдёт никогда: сервер
// ответил бы 422 «поля нет в схеме типа».
export function buildDetails(schema: readonly FieldDef[], values: FieldValues): Record<string, string> {
  return Object.fromEntries(
    schema
      .filter((f) => fieldState(f, values) === "ok")
      .map((f) => [f.key, String(detailValue(values, f.key)).trim()])
  );
}

export function missingItems(i: {
  schema: readonly FieldDef[];
  values: FieldValues;
  // true: у менеджера несколько филиалов и он ещё не выбрал.
  branchUnchosen: boolean;
  photoCount: number;
  photosProcessing: number;
}): string[] {
  const out: string[] = [];
  if (i.branchUnchosen) out.push("Выберите филиал");
  for (const f of i.schema) {
    const label = f.label_ru || f.key;
    const s = fieldState(f, i.values);
    if (s === "invalid") out.push(`Проверьте поле «${label}»`);
    else if (s === "empty" && f.required) {
      out.push(f.type === "select" ? `Выберите «${label}»` : `Заполните «${label}»`);
    }
  }
  if (i.photosProcessing > 0) out.push("Дождитесь обработки фотографий");
  else if (i.photoCount === 0) out.push("Добавьте хотя бы одну фотографию");
  return out;
}

// ---------------------------------------------------------------------------
// тело запроса
// ---------------------------------------------------------------------------

// Отказ до сети: запрос, который заведомо будет отвергнут, не уходит.
export class CreateBlocked extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreateBlocked";
  }
}

export type CreateInput = {
  typeId: string;
  // null: филиал не выбран или его нет вовсе (офисная роль).
  terminalId: string | null;
  priority: TicketPriority;
  details: Record<string, string>;
  description: string;
  photos: readonly File[];
};

// Поле файлов называется `photos` (не `photos[]`): так оно объявлено в
// t.Files() роута, и Elysia сопоставляет ключ буквально. terminal_id уходит
// всегда, даже когда филиал один: пустая строка дала бы 403 (`"" ?? x` не
// подставляет запасной), а отсутствующее поле сервер заменил бы первым
// терминалом сессии. Content-Type не ставится: границу multipart добавит
// браузер.
export function buildCreateFormData(i: CreateInput): FormData {
  if (!i.terminalId?.trim()) {
    throw new CreateBlocked(
      "Заявка не отправлена: не выбран филиал. Этот экран для менеджера, за которым закреплён филиал."
    );
  }
  if (!i.typeId) throw new CreateBlocked("Заявка не отправлена: не выбран тип.");
  if (i.photos.length === 0) throw new CreateBlocked("Заявка не отправлена: нужна хотя бы одна фотография.");
  if (i.photos.length > MAX_PHOTOS) {
    throw new CreateBlocked(`Заявка не отправлена: не больше ${MAX_PHOTOS} фотографий.`);
  }
  const fd = new FormData();
  fd.append("type_id", i.typeId);
  fd.append("terminal_id", i.terminalId);
  fd.append("priority", i.priority);
  fd.append("details", JSON.stringify(i.details));
  const description = i.description.trim();
  if (description) fd.append("description", description);
  for (const f of i.photos) fd.append("photos", f, f.name);
  return fd;
}

// ---------------------------------------------------------------------------
// отказ сервера
// ---------------------------------------------------------------------------

export type SubmitFailure = {
  message: string;
  // Тип или схема за время заполнения могли измениться: список надо обновить.
  refetchTypes: boolean;
  // Ответа не было или он ненадёжен: заявка могла создаться. Повторять
  // вслепую нельзя, иначе получится дубль с теми же фотографиями: экран
  // держит отправку закрытой, пока менеджер сам не подтвердит повтор.
  outcomeUnknown: boolean;
};

// Чем кончился запрос без нормального ответа сервера (ставит postTicket).
export type NoAnswerKind = "network" | "timeout" | "no_body";

// Текст для панели «не удалось загрузить» (филиалы, типы, список). Ответ нашего
// сервера (есть статус) и наши собственные русские тексты показываются как есть.
// Всё остальное, то есть необработанное исключение fetch вроде «Failed to
// fetch», человеку не нужно: он получает понятную фразу, а сырой текст уходит
// в консоль (один раз на объект ошибки, потому что функцию зовёт рендер).
const LOGGED_LOAD_ERRORS = new WeakSet<object>();
export const NO_CONNECTION_TEXT = "Нет связи с сервером. Проверьте интернет и повторите.";

export function loadErrorText(error: unknown): string {
  const e = error as { status?: unknown; message?: unknown } | null | undefined;
  const message = typeof e?.message === "string" ? e.message : "";
  if (typeof e?.status === "number" || /[А-Яа-яЁё]/.test(message)) return message || "Не удалось выполнить запрос";
  if (e && typeof e === "object" && !LOGGED_LOAD_ERRORS.has(e)) {
    LOGGED_LOAD_ERRORS.add(e);
    console.error("tickets: загрузка не удалась", error);
  }
  return NO_CONNECTION_TEXT;
}

const CHECK_LIST = "Откройте список заявок филиала и проверьте, нет ли там новой";

export function describeFailure(e: unknown): SubmitFailure {
  const err = e as {
    status?: number;
    message?: string;
    errors?: unknown;
    kind?: NoAnswerKind;
    // true: тело ответа разобрано как JSON с `message`, то есть отвечал наш
    // бэкенд. Ставит postTicket.
    bodyParsed?: boolean;
  } | null;
  const server = typeof err?.message === "string" && err.message ? err.message : "Не удалось создать заявку";
  if (err instanceof CreateBlocked) return { message: server, refetchTypes: false, outcomeUnknown: false };

  const unknown = (message: string): SubmitFailure => ({ message, refetchTypes: false, outcomeUnknown: true });
  const status = err?.status;
  if (status === undefined || err?.kind) {
    if (err?.kind === "timeout") {
      return unknown(`Сервер не ответил за отведённое время, и неизвестно, дошла ли заявка. ${CHECK_LIST}, прежде чем создавать ещё одну.`);
    }
    if (err?.kind === "no_body") {
      return unknown(`Сервер ответил, но без данных заявки: неизвестно, создалась ли она. ${CHECK_LIST}, прежде чем создавать ещё одну.`);
    }
    if (err?.kind === "network" || status === undefined) {
      // Любой другой сбой до ответа сервера читается так же: ответа нет. Сырой
      // текст ошибки человеку не показываем (его пишет в консоль хук).
      return unknown(
        err?.kind === "network"
          ? `Связь оборвалась, и неизвестно, дошла ли заявка до сервера. ${CHECK_LIST}, прежде чем создавать ещё одну.`
          : `Не удалось отправить заявку, и неизвестно, дошла ли она до сервера. ${CHECK_LIST}, прежде чем создавать ещё одну.`
      );
    }
  }
  if (status === 502 || status === 503 || status === 504) {
    return unknown(`Сервер не ответил вовремя (код ${status}). Заявка могла создаться. ${CHECK_LIST}, прежде чем создавать ещё одну.`);
  }
  // 5xx различаем по телу, а не по коду. Наш бэкенд всегда отвечает JSON с
  // `message`, и достижимый 500 от него значит «ничего не создано». А прокси
  // Next (/api/* переписывается на бэкенд, таймаут 30 с, любой обрыв) на своей
  // ошибке отдаёт 500 с плоским текстом «Internal Server Error»: запрос мог
  // дойти и заявка создаться. Тело не разобрано, значит исход неизвестен.
  if (status !== undefined && status >= 500 && !err?.bodyParsed) {
    return unknown(
      `Сервер вернул ошибку без пояснения (код ${status}), и неизвестно, создалась ли заявка. ${CHECK_LIST}, прежде чем создавать ещё одну.`
    );
  }
  const list = Array.isArray(err?.errors) ? (err!.errors as unknown[]).filter((x) => typeof x === "string") : [];
  const detailed = list.length ? `${server}: ${list.join("; ")}` : server;
  if (status === 401) {
    return { message: "Сессия истекла. Войдите заново, заявка не создана.", refetchTypes: false, outcomeUnknown: false };
  }
  if (status === 403 && /Филиал недоступен/.test(server)) {
    return {
      message: "Филиал недоступен для вашей учётной записи. Возможно, вас перевели: выйдите и войдите заново.",
      refetchTypes: false,
      outcomeUnknown: false,
    };
  }
  if (status === 404 || status === 422) {
    return {
      message: `${detailed}. Список типов обновлён: проверьте тип и поля и отправьте ещё раз.`,
      refetchTypes: true,
      outcomeUnknown: false,
    };
  }
  if (status === 413) {
    return { message: "Фотографии слишком большие для отправки. Уберите часть и попробуйте снова.", refetchTypes: false, outcomeUnknown: false };
  }
  return { message: detailed, refetchTypes: false, outcomeUnknown: false };
}

// ---------------------------------------------------------------------------
// фотографии
// ---------------------------------------------------------------------------

export function fitWithin(width: number, height: number, max: number = MAX_PHOTO_SIDE) {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const k = max / longest;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

// Перекодированный файл — всегда JPEG, и имя должно это говорить: сервер
// выбирает расширение по mime, а человек видит имя в превью.
export function jpegName(name: string): string {
  const n = name.trim();
  if (!n) return "photo.jpg";
  if (/\.jpe?g$/i.test(n)) return n;
  return /\.[^./\\]+$/.test(n) ? n.replace(/\.[^./\\]+$/, ".jpg") : `${n}.jpg`;
}

export interface PhotoIO<I> {
  // Бросает, если файл не картинка, которую браузер способен разобрать.
  decode(file: File): Promise<{ image: I; width: number; height: number }>;
  // null: canvas.toBlob не справился (бывает на очень больших кадрах в Safari).
  encode(image: I, width: number, height: number): Promise<Blob | null>;
  release(image: I): void;
}

export type PhotoOutcome = { ok: true; file: File; recompressed: boolean } | { ok: false; error: string };

const fail = (error: string): PhotoOutcome => ({ ok: false, error });

// Что уйдёт на сервер вместо выбранного файла. Не бросает: отказ приходит
// значением с читаемым текстом.
//
// Решение о сжатии:
//  - файл должен декодироваться (это и есть проверка «картинка ли это»,
//    mime у браузера может быть пустым или врать);
//  - длинная сторона больше 1600, mime не JPEG/PNG или размер больше лимита
//    сервера: перекодируем в JPEG 0.85 с длинной стороной 1600;
//  - иначе оригинал уходит как есть, с тем же именем и типом;
//  - toBlob вернул null: оригинал, если он сам годится (JPEG/PNG до 10 МБ),
//    иначе отказ. Тихо отправлять негодное нельзя;
//  - результат не меньше оригинала: оригинал, если он годится.
export async function preparePhoto<I>(file: File, io: PhotoIO<I>): Promise<PhotoOutcome> {
  const label = file.name || "файл";
  if (file.size <= 0) return fail(`${label}: пустой файл`);

  let decoded: { image: I; width: number; height: number };
  try {
    decoded = await io.decode(file);
  } catch {
    return fail(`${label}: не удаётся открыть как изображение. Нужны JPEG или PNG, снятые камерой или выбранные из галереи`);
  }
  const { image, width, height } = decoded;
  try {
    if (!(width > 0 && height > 0)) return fail(`${label}: изображение без размеров`);

    const originalFits = isAcceptedMime(file.type) && file.size <= MAX_PHOTO_BYTES;
    if (originalFits && Math.max(width, height) <= MAX_PHOTO_SIDE) {
      return { ok: true, file, recompressed: false };
    }

    const to = fitWithin(width, height);
    let blob: Blob | null = null;
    try {
      blob = await io.encode(image, to.width, to.height);
    } catch {
      blob = null;
    }
    // Safari подменяет неподдержанный формат PNG-ом молча: проверяем тип.
    if (!blob || blob.size <= 0 || blob.type !== "image/jpeg") {
      if (originalFits) return { ok: true, file, recompressed: false };
      return fail(`${label}: не удалось подготовить фотографию к отправке. Снимите ещё раз или выберите другой файл`);
    }
    if (originalFits && blob.size >= file.size) return { ok: true, file, recompressed: false };
    if (blob.size > MAX_PHOTO_BYTES) return fail(`${label}: после сжатия больше ${MAX_PHOTO_MB} МБ`);
    return {
      ok: true,
      file: new File([blob], jpegName(file.name), { type: "image/jpeg", lastModified: file.lastModified }),
      recompressed: true,
    };
  } finally {
    io.release(image);
  }
}
