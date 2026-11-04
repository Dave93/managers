# KPI: посещаемость в мини-приложении Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сотрудник открывает в мини-приложении экран «Моя посещаемость»: дни месяца со временем прихода и ухода, опозданием в минутах и отметкой «не вышел», с переключателем на другие месяцы. Данные те, что уже лежат в `kpi_attendance`; новых источников нет.

**Architecture:** Один новый маршрут `GET /kpi/tg/attendance` под существующим Bearer-guard мини-приложения отдаёт только строки сотрудника из сессии. Правила показа (опоздание только при `late_minutes > 0`, «нет отметки», «не вышел») живут в чистой модели вида `view/attendance.ts` и проверяются unit-тестами; DOM-слой `screens/attendance.ts` только рисует модель. Маршрут клиента `#/attendance[/YYYY-MM]` хранит месяц в хеше, ссылка на экран добавляется в карточку строк главного экрана.

**Tech Stack:** Bun, Elysia, Drizzle/PostgreSQL (`backend`); TypeScript + Vite без фреймворка (`kpi_miniapp`); `bun test`.

**Spec:** `docs/superpowers/specs/2026-11-04-kpi-hr-feedback-design.md` (пункт 6 и разделы «Не делаем», «Ограничения», «Решено владельцем 04.11», «Решения, принятые без владельца»); `docs/superpowers/specs/2026-10-26-kpi-employee-miniapp-design.md` (разделы 6, 7, 9).

## Global Constraints

- Маршрут `GET /kpi/tg/attendance?month=YYYY-MM` (в тестах с префиксом `/api`), только сессия сотрудника через `requireEmployee`; `employee_id` берётся из сессии, параметра сотрудника нет (спека мини-приложения, раздел 7).
- Показываются только дни, у которых есть строка в `kpi_attendance`; выходные и неизвестные дни без строки не рисуются.
- «Не вышел» это `absent = true`.
- Опоздание показывается только когда `late_minutes` больше нуля: у файловых импортов без колонки опоздания оно всегда 0, и «0 минут» было бы враньём.
- Если у дня есть приход без ухода, уход пишется как «нет отметки».
- Если за месяц нет ни одной строки, экран пишет «Данных за месяц нет».
- Новый источник данных не заводится: читаем `kpi_attendance` так же, как `attendanceStats` в `backend/src/modules/kpi/attendance.ts`. Миграций нет.
- Ночную синхронизацию посещаемости (`WORKLY_ATTENDANCE_NIGHTLY`) не включаем и не трогаем; экран выпускается пустым и показывает только загруженное вручную.
- Новых прав доступа нет.
- Время: API отдаёт ISO 8601 UTC через `iso()`, клиент показывает его по Asia/Tashkent (UTC+5 фиксированно) функцией `hhmm` из `kpi_miniapp/src/format.ts`; `day` и `month` это строки без часового пояса.
- Мини-приложение знает два языка: `ru` и `uz` (латиница), `TgLang = "ru" | "uz"`. Словаря uz-Cyrl в мини-приложении нет и этот поток его не заводит. Узбекские тексты это черновик, носитель их не проверял; отметить в описании PR.
- Тесты бэкенда идут только на `managers_tickets_test`. `TEST_DATABASE_URL` по умолчанию не задан: собрать из `DATABASE_URL` в `backend/.env`, заменив только имя базы на `managers_tickets_test`, и не печатать (в строке пароль; см. `backend/tests/helpers/README.md`). Локальную базу `managers` не мигрируем.
- `cleanupKpi` стирает все строки KPI-таблиц тестовой базы, Redis-префикс общий: не запускать набор `kpi/http` одновременно с другим worktree.
- Не заявлять «тесты прошли» без реального запуска.
- UI мини-приложения (спека мини-приложения, раздел 9, и шапка `style.css`): тач-цели не меньше `--tap` (44 px), основной текст не меньше 14 px, `tabular-nums` у времени, контраст AA в обеих темах, проверка на 360 px; без flex `gap`, `inset`, `:is`/`:where` (cssTarget chrome64).
- Общие файлы с другими потоками: `kpi_miniapp/src/i18n.ts`, `backend/src/modules/kpi/tg-app/types.ts`, `kpi_miniapp/src/screens/home.ts`, `kpi_miniapp/src/main.ts`, `kpi_miniapp/src/route.ts`, `kpi_miniapp/src/style.css`, таблицы в `docs/superpowers/specs/2026-10-26-kpi-employee-miniapp-design.md`. Правки только добавляющие и с якорем не в конце файла: поток `tg-evaluator` скорее всего дописывает в тех же местах. Якоря указаны в задачах.
- Коммиты: только свои файлы по явному pathspec, никогда `git add -A`. Сообщения на русском, conventional, последней строкой `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Чужие строки. У двух сотрудников в одном месяце строки на один и тот же день; к запросу сотрудника A дописан `employee_id=<id B>`; отдельно сессия оценщика без привязки сотрудника и запрос без токена. Ожидание: A видит только своё, оценщик получает 403 `not_employee`, без токена 401. Тесты «только свои дни» и «не сотрудник и без сессии» в Task 2.
- Граница месяца по Ташкенту. «Сейчас» 31 октября 20:00 UTC (уже 1 ноября 01:00 в Ташкенте), у дня 31 октября уход в 20:30 UTC. Ожидание: месяц по умолчанию ноябрь, день 31 октября остаётся в октябре, уход показан как 01:30. Тест «месяц по Ташкенту» в Task 2 и тест «ночной уход» в Task 4.
- Ложный ноль и ложный прогул. `late_minutes = 0` не даёт текста про опоздание; строка с `absent = true` не показывает ни времён, ни опоздания, даже если они лежат в данных. Тесты в Task 4.
- Полуотмеченные дни. Приход без ухода, уход без прихода, строка без единой отметки у не отсутствовавшего. Ожидание: «нет отметки» на месте недостающей отметки, прочерки, если отметок нет совсем. Тест в Task 4.
- Кривой и пустой месяц. `2026-13`, `2026-11-01`, пустое значение дают 422 `bad_period`; месяц без строк при данных за другие месяцы отвечает 200 с пустыми `days`, а `prev`/`next` ведут к ближайшим месяцам со строками, так что переключатель не тупик. Адрес `#/attendance/2026-13` открывает главный экран. Тесты: `monthOf` и `neighbours` в Task 1, «кривой месяц» и «месяц без строк» в Task 2, `parseHash` в Task 3.

## Решения сверх спеки

Спека молчит, выбрано при планировании; оговорить в описании PR.

- Уход без прихода тоже «нет отметки»; строка без отметок у не отсутствовавшего показывает «—» в обеих ячейках.
- День с `absent = true` скрывает времена и опоздание.
- Дни идут новыми сверху.
- Переключатель ведёт к ближайшему месяцу со строками (пустые месяцы пропускает) и всегда к текущему. Пустой месяц открывается по адресу и показывает «Данных за месяц нет».
- Весь эндпоинт говорит `YYYY-MM` (запрос, ответ, хеш), хотя шапка `types.ts` описывает периоды как `YYYY-MM-01`; на типе об этом комментарий. Имя параметра `month`, а не `period`, по заданию потока.
- Переключение месяцев заменяет вершину стека экранов: одно нажатие «Назад» возвращает на главный.
- Ссылка стоит у любого сотрудника, в том числе без карты KPI; у оценщика без привязки сотрудника её нет.
- Заголовок экрана и ссылка на главном называются «Моя посещаемость» (одним ключом `link_attendance`); месяц с годом показан в переключателе («Ноябрь 2026»).

---

### Task 1: Типы ответа и чистые правила месяца

**Files:**
- Modify: `backend/src/modules/kpi/tg-app/types.ts` (вставить блок сразу после блока `TgHistory`, перед `// POST /api/kpi/tg/disputes`)
- Create: `backend/src/modules/kpi/tg-app/attendance-rules.ts`
- Test: Create `backend/src/modules/kpi/tg-app/attendance-rules.test.ts`

**Interfaces:**
- Produces в `types.ts`:

```ts
// GET /api/kpi/tg/attendance?month=YYYY-MM
// Месяц здесь везде «YYYY-MM» (запрос, ответ, хеш клиента), а не «YYYY-MM-01» как у остальных экранов.
// Без month сервер берёт текущий месяц по Ташкенту. Дни новыми сверху, только дни со строкой в kpi_attendance.
// prev и next — ближайшие месяцы со строками сотрудника (текущий месяц достижим всегда); null — дальше нет.
export interface TgAttendanceDay { day: string; check_in: string | null; check_out: string | null; late_minutes: number; absent: boolean } // day "YYYY-MM-DD"
export interface TgAttendance { month: string; prev: string | null; next: string | null; days: TgAttendanceDay[] }
```

- Produces в `attendance-rules.ts` (без импортов, env не нужен): `monthOf(v: unknown): string | null` (строго `YYYY-MM`, месяц 01..12, иначе `null`); `neighbours(withData: string[], month: string, current: string): { prev: string | null; next: string | null }`.
- `TgErrorCode` не меняется: `bad_period` и `not_employee` в нём уже есть.

- [ ] **Step 1: Написать падающий тест** `backend/src/modules/kpi/tg-app/attendance-rules.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { monthOf, neighbours } from "./attendance-rules";

describe("kpi tg-app: правила месяца посещаемости", () => {
  it("monthOf: только YYYY-MM с месяцем 01..12", () => {
    expect(monthOf("2026-11")).toBe("2026-11");
    expect(monthOf("2026-12")).toBe("2026-12");
    for (const bad of ["2026-13", "2026-00", "2026-1", "26-11", "2026-11-01", "", " 2026-11", "abc", null, undefined, 202611, ["2026-11"]]) {
      expect(monthOf(bad)).toBeNull();
    }
  });

  it("neighbours: ближайшие месяцы со строками, текущий достижим всегда", () => {
    const data = ["2026-06", "2026-08"];
    expect(neighbours(data, "2026-11", "2026-11")).toEqual({ prev: "2026-08", next: null });
    expect(neighbours(data, "2026-07", "2026-11")).toEqual({ prev: "2026-06", next: "2026-08" });
    expect(neighbours(data, "2026-08", "2026-11")).toEqual({ prev: "2026-06", next: "2026-11" });
    expect(neighbours(data, "2026-06", "2026-11")).toEqual({ prev: null, next: "2026-08" });
    expect(neighbours(data, "2027-03", "2026-11")).toEqual({ prev: "2026-11", next: null });
  });

  it("neighbours: нет данных, порядок и дубликаты на входе не важны", () => {
    expect(neighbours([], "2026-11", "2026-11")).toEqual({ prev: null, next: null });
    expect(neighbours(["2026-11"], "2026-11", "2026-11")).toEqual({ prev: null, next: null });
    expect(neighbours(["2026-08", "2026-06", "2026-08"], "2026-07", "2026-11")).toEqual({ prev: "2026-06", next: "2026-08" });
  });
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `cd /Users/macbookpro/development/managers-kpi/backend && bun test src/modules/kpi/tg-app/attendance-rules.test.ts`
Expected: FAIL, `Cannot find module './attendance-rules'`.

- [ ] **Step 3: Реализовать.** Типы из блока выше вставить в `types.ts`. В `attendance-rules.ts`: `monthOf` проверяет `typeof v === "string"` и регулярное выражение `^\d{4}-(0[1-9]|1[0-2])$`; `neighbours` берёт множество `withData` плюс `current` и возвращает наибольший элемент строго меньше `month` как `prev` и наименьший строго больше как `next` (строки `YYYY-MM` сравниваются лексикографически).

- [ ] **Step 4: Запустить и убедиться, что проходит**

Run: `cd /Users/macbookpro/development/managers-kpi/backend && bun test src/modules/kpi/tg-app/attendance-rules.test.ts`
Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
cd /Users/macbookpro/development/managers-kpi
git add backend/src/modules/kpi/tg-app/types.ts backend/src/modules/kpi/tg-app/attendance-rules.ts backend/src/modules/kpi/tg-app/attendance-rules.test.ts
git commit -m "feat(kpi): типы ответа посещаемости и правила месяца для мини-приложения" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Маршрут `GET /kpi/tg/attendance`

**Files:**
- Create: `backend/src/modules/kpi/tg-app/attendance.ts`
- Modify: `backend/src/modules/kpi/routes/tg-app.ts` (импорт и новый `.get(...)` сразу после маршрута `/kpi/tg/history`)
- Modify: `docs/superpowers/specs/2026-10-26-kpi-employee-miniapp-design.md` (две строки таблиц: после `| Причина отмены нарушения | да | |` в разделе 6 и после строки `GET /api/kpi/tg/history` в разделе 7)
- Test: Create `backend/src/modules/kpi/http/tg-attendance.test.ts`

**Interfaces:**
- Consumes: `monthOf`, `neighbours` (Task 1); `TgAttendance`, `TgAttendanceDay` (Task 1); `requireEmployee(p: KpiTgPrincipal): string` из `tg-app/ctx.ts`; `periodOf`, `addMonths` из `../time`; `iso` из `../iso`; `KpiError` из `../errors`; таблица `kpi_attendance`.
- Produces: `attendanceFor(db: DbLike, employeeId: string, monthRaw: unknown, at: Date): Promise<TgAttendance>` в `tg-app/attendance.ts`; HTTP `GET /api/kpi/tg/attendance?month=YYYY-MM`.

- [ ] **Step 1: Написать падающий тест** `backend/src/modules/kpi/http/tg-attendance.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";

// Тот же guard, что в tg-app-home.test.ts: голый `bun test` пропускает файл.
const dbLooksLikeTest = process.env.DATABASE_URL?.endsWith("/managers_tickets_test") ?? false;
const prefixLooksLikeTest = process.env.PROJECT_PREFIX === "managers_test_";

if (!dbLooksLikeTest && !prefixLooksLikeTest) {
  describe.skip("kpi/tg-app attendance (пропущено: запускайте через bun run test:http:kpi)", () => {
    it("пропущено — нет тестового окружения", () => {});
  });
} else {
  const { sweepTestRoles } = await import("../../../../tests/helpers/http");
  const { bindTelegram, cleanupKpi, fakeBotApi, makeEmployee, makeUser, setNow, setup, tgApi, tgLogin, TG_TEST_BOT_TOKEN } = await import("./fixtures");
  const { kpi_attendance, kpi_attendance_imports } = await import("backend/drizzle/schema");
  const { setTestBotApi } = await import("../tg/bot-api");

  const login = async (b: { telegram_id: number }) => (await tgLogin(b.telegram_id)).body.token as string;
  type Day = { day: string; check_in?: string; check_out?: string; late_minutes?: number; absent?: boolean };
  const row = (d: Day) => ({ day: d.day, check_in: d.check_in ?? null, check_out: d.check_out ?? null, late_minutes: d.late_minutes ?? 0, absent: d.absent ?? false });

  describe("kpi: посещаемость в мини-приложении", () => {
    let db: Awaited<ReturnType<typeof setup>>["db"];
    let prevToken: string | undefined;

    // Строки напрямую; родитель-импорт нужен из-за внешнего ключа import_id.
    const seed = async (e: { id: string; terminal_id: string }, days: Day[]) => {
      const [imp] = await db
        .insert(kpi_attendance_imports)
        .values({ period: `${days[0]!.day.slice(0, 7)}-01`, file_name: "tg-attendance-test", mapping: {}, rows_total: days.length, rows_matched: days.length })
        .returning({ id: kpi_attendance_imports.id });
      await db.insert(kpi_attendance).values(days.map((d) => ({ ...row(d), employee_id: e.id, terminal_id: e.terminal_id, import_id: imp!.id })));
    };
    const sessionOf = async () => {
      const e = await makeEmployee(db, { role_code: "cook" });
      return { e, token: await login(await bindTelegram(db, { employee_id: e.id })) };
    };

    beforeAll(async () => {
      ({ db } = await setup());
      await cleanupKpi(db);
      prevToken = process.env.KPI_BOT_TOKEN;
      process.env.KPI_BOT_TOKEN = TG_TEST_BOT_TOKEN;
    }, 180000);

    beforeEach(() => {
      setTestBotApi(fakeBotApi().api);
    });

    afterAll(async () => {
      setNow(null);
      if (prevToken === undefined) delete process.env.KPI_BOT_TOKEN;
      else process.env.KPI_BOT_TOKEN = prevToken;
      setTestBotApi(null);
      await cleanupKpi(db);
      await sweepTestRoles();
    });

    it("только свои дни: строки другого сотрудника того же месяца не приходят, чужой employee_id в запросе игнорируется", async () => {
      setNow("2026-11-10T10:00:00+05:00");
      const a = await sessionOf();
      const b = await sessionOf();
      await seed(a.e, [
        { day: "2026-11-03", check_in: "2026-11-03T03:55:00.000Z", check_out: "2026-11-03T13:02:00.000Z" },
        { day: "2026-11-04", absent: true },
      ]);
      await seed(b.e, [
        { day: "2026-11-03", check_in: "2026-11-03T04:40:00.000Z", check_out: "2026-11-03T13:30:00.000Z", late_minutes: 45 },
        { day: "2026-11-05", check_in: "2026-11-05T04:00:00.000Z" },
      ]);
      const ra = await tgApi(a.token, "GET", `/api/kpi/tg/attendance?month=2026-11&employee_id=${b.e.id}`);
      expect(ra).toEqual({
        status: 200,
        body: {
          month: "2026-11", prev: null, next: null,
          days: [
            { day: "2026-11-04", check_in: null, check_out: null, late_minutes: 0, absent: true },
            { day: "2026-11-03", check_in: "2026-11-03T03:55:00.000Z", check_out: "2026-11-03T13:02:00.000Z", late_minutes: 0, absent: false },
          ],
        },
      });
      const rb = await tgApi(b.token, "GET", "/api/kpi/tg/attendance?month=2026-11");
      expect(rb.body.days).toEqual([
        { day: "2026-11-05", check_in: "2026-11-05T04:00:00.000Z", check_out: null, late_minutes: 0, absent: false },
        { day: "2026-11-03", check_in: "2026-11-03T04:40:00.000Z", check_out: "2026-11-03T13:30:00.000Z", late_minutes: 45, absent: false },
      ]);
    });

    it("не сотрудник и без сессии: 403 not_employee и 401", async () => {
      const u = await makeUser(db);
      const token = await login(await bindTelegram(db, { user_id: u.id }));
      expect(await tgApi(token, "GET", "/api/kpi/tg/attendance")).toEqual({ status: 403, body: { error: "not_employee" } });
      expect(await tgApi(null, "GET", "/api/kpi/tg/attendance")).toEqual({ status: 401, body: { error: "unauthorized" } });
    });

    it("месяц по Ташкенту: в 20:00 UTC 31 октября уже ноябрь, день 31 октября и ночной уход остаются в октябре", async () => {
      setNow("2026-10-31T20:00:00Z");
      const { e, token } = await sessionOf();
      await seed(e, [
        { day: "2026-09-30", absent: true },
        { day: "2026-10-31", check_in: "2026-10-31T10:00:00.000Z", check_out: "2026-10-31T20:30:00.000Z" },
        { day: "2026-11-01", check_in: "2026-11-01T03:00:00.000Z" },
      ]);
      expect((await tgApi(token, "GET", "/api/kpi/tg/attendance")).body).toEqual({
        month: "2026-11", prev: "2026-10", next: null,
        days: [{ day: "2026-11-01", check_in: "2026-11-01T03:00:00.000Z", check_out: null, late_minutes: 0, absent: false }],
      });
      expect((await tgApi(token, "GET", "/api/kpi/tg/attendance?month=2026-10")).body).toEqual({
        month: "2026-10", prev: "2026-09", next: "2026-11",
        days: [{ day: "2026-10-31", check_in: "2026-10-31T10:00:00.000Z", check_out: "2026-10-31T20:30:00.000Z", late_minutes: 0, absent: false }],
      });
    });

    it("месяц без строк: 200, пустые days, переключатель ведёт к ближайшим месяцам со строками", async () => {
      setNow("2026-11-10T10:00:00+05:00");
      const { e, token } = await sessionOf();
      await seed(e, [{ day: "2026-06-15", absent: true }, { day: "2026-08-20", absent: true }]);
      const get = async (q: string) => (await tgApi(token, "GET", `/api/kpi/tg/attendance${q}`)).body;
      expect(await get("")).toEqual({ month: "2026-11", prev: "2026-08", next: null, days: [] });
      expect(await get("?month=2026-07")).toEqual({ month: "2026-07", prev: "2026-06", next: "2026-08", days: [] });
      const aug = await get("?month=2026-08");
      expect([aug.prev, aug.next, aug.days.length]).toEqual(["2026-06", "2026-11", 1]);
      const fresh = await sessionOf();
      expect((await tgApi(fresh.token, "GET", "/api/kpi/tg/attendance")).body).toEqual({ month: "2026-11", prev: null, next: null, days: [] });
    });

    it("кривой месяц: 422 bad_period", async () => {
      const { token } = await sessionOf();
      for (const bad of ["2026-13", "2026-00", "2026-11-01", "2026-1", "26-11", "", "abc"]) {
        expect(await tgApi(token, "GET", `/api/kpi/tg/attendance?month=${bad}`)).toEqual({ status: 422, body: { error: "bad_period" } });
      }
    });
  });
}
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run (из `backend`, `TEST_DATABASE_URL` задан, см. Global Constraints):
`cd /Users/macbookpro/development/managers-kpi/backend && PROJECT_PREFIX=managers_test_ KPI_UPLOADS_DIR=/tmp/kpi_test_uploads KPI_NOTIFY_QUEUE=kpi_notify_test KPI_BOT_USERNAME=kpi_test_bot KPI_WEBHOOK_SECRET=kpi_test_secret DATABASE_URL=$TEST_DATABASE_URL bun test src/modules/kpi/http/tg-attendance.test.ts`
Expected: все 5 тестов FAIL (маршрута нет, везде статус 404 вместо 200, 403 и 422).

- [ ] **Step 3: Реализовать `attendanceFor`** в `tg-app/attendance.ts`. Подход: `current = periodOf(at).slice(0, 7)`; `month = monthRaw === undefined ? current : monthOf(monthRaw)`, при `null` бросить `new KpiError(422, "bad_period")`; дни читаются из `kpi_attendance` по `employee_id` и `day >= "<month>-01"` и `day < addMonths("<month>-01", 1)` (как `attendanceStats`), порядок `day desc`, времена через `iso()`; месяцы со строками сотрудника через `selectDistinct` от ``sql<string>`to_char(${kpi_attendance.day}, 'YYYY-MM')` `` по тому же `employee_id`; ответ `{ month, ...neighbours(withData, month, current), days }`.

- [ ] **Step 4: Подключить маршрут** в `routes/tg-app.ts` после `/kpi/tg/history`, по образцу `/kpi/tg/review`: путь `/kpi/tg/attendance`, обработчик `run(set, async (): Promise<TgAttendance> => attendanceFor(drizzle, requireEmployee(tg), query.month, now()))`, схема запроса `{ query: t.Object({ month: t.Optional(t.Any()) }) }` (значение проверяет `attendanceFor`: кривое даёт наш 422, а не ответ схемы). Добавить импорт `attendanceFor` и тип `TgAttendance`.

- [ ] **Step 5: Записать строки в спеку мини-приложения** (точный текст):
  - раздел 6, после `| Причина отмены нарушения | да | |`: `| Свои дни посещаемости: приход, уход, опоздание, «не вышел» | да | Это его данные из Workly; чужие строки сервер не отдаёт |`
  - раздел 7, после строки `GET /api/kpi/tg/history`: ``| `GET /api/kpi/tg/attendance?month=YYYY-MM` | Свои дни посещаемости месяца и соседние месяцы со строками. Без `month` текущий по Ташкенту. Только сессия сотрудника |``

- [ ] **Step 6: Запустить и убедиться, что проходит**

Run: та же команда, что в Step 2.
Expected: 5 pass, 0 fail. Затем один раз весь набор: `cd /Users/macbookpro/development/managers-kpi/backend && bun run test:http:kpi`, ожидание: все файлы `kpi/http` зелёные.

- [ ] **Step 7: Commit**

```bash
cd /Users/macbookpro/development/managers-kpi
git add backend/src/modules/kpi/tg-app/attendance.ts backend/src/modules/kpi/routes/tg-app.ts backend/src/modules/kpi/http/tg-attendance.test.ts docs/superpowers/specs/2026-10-26-kpi-employee-miniapp-design.md
git commit -m "feat(kpi): GET /kpi/tg/attendance — свои дни посещаемости для мини-приложения" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Маршрут клиента и тексты

**Files:**
- Modify: `kpi_miniapp/src/route.ts` (вариант `Route` после `history`; ветка `parseHash` после `/history`; `case` в `hashOf` после `history`)
- Modify: `kpi_miniapp/src/i18n.ts` (новые ключи сразу после `hist_upcoming` в `RU` и в `UZ`)
- Test: Modify `kpi_miniapp/test/route.test.ts`, `kpi_miniapp/test/i18n.test.ts`

**Interfaces:**
- Produces: вариант `{ name: "attendance"; month: string | null }` в `Route` (`null` значит текущий месяц; `month` это `YYYY-MM`); хеши `#/attendance` и `#/attendance/YYYY-MM`.
- Produces: ключи словаря (`Key`), добавляются в RU и UZ одновременно:

| Ключ | ru | uz (латиница, черновик) |
|---|---|---|
| `link_attendance` | Моя посещаемость | Mening davomatim |
| `att_in` | Приход | Kelish |
| `att_out` | Уход | Ketish |
| `att_no_mark` | нет отметки | belgi yoʻq |
| `att_absent` | не вышел | ishga chiqmadi |
| `att_late` | опоздание {n} мин | {n} daqiqa kechikdi |
| `att_prev` | Предыдущий месяц | Oldingi oy |
| `att_next` | Следующий месяц | Keyingi oy |
| `att_empty` | Данных за месяц нет | Oy uchun maʼlumot yoʻq |

В узбекских строках `ʻ` это U+02BB, `ʼ` это U+02BC; ASCII-апострофа нет (проверяет существующий тест словарей). Заглавной остаётся только первая буква шаблона, начинающегося с `{`: `tIn` делает это сам.

- [ ] **Step 1: Написать падающие тесты.** В `route.test.ts` добавить:

```ts
it("parseHash и hashOf: посещаемость", () => {
  expect(parseHash("#/attendance")).toEqual({ name: "attendance", month: null });
  expect(parseHash("#/attendance/2026-10")).toEqual({ name: "attendance", month: "2026-10" });
  expect(parseHash("#/attendance/2026-10?tgWebAppData=abc&tgWebAppVersion=7.10")).toEqual({ name: "attendance", month: "2026-10" });
  for (const h of ["#/attendance/2026-13", "#/attendance/2026-10-01", "#/attendance/26-10", "#/attendance/"]) expect(parseHash(h)).toEqual({ name: "home" });
  expect([hashOf({ name: "attendance", month: null }), hashOf({ name: "attendance", month: "2026-10" })]).toEqual(["#/attendance", "#/attendance/2026-10"]);
});
```

В `i18n.test.ts` добавить (импорты `DICT`, `setLang`, `t` там уже есть):

```ts
it("посещаемость: тексты по спеке", () => {
  expect([DICT.ru.link_attendance, DICT.ru.att_empty, DICT.ru.att_no_mark, DICT.ru.att_absent]).toEqual(["Моя посещаемость", "Данных за месяц нет", "нет отметки", "не вышел"]);
  expect([DICT.uz.att_empty, DICT.uz.att_no_mark]).toEqual(["Oy uchun maʼlumot yoʻq", "belgi yoʻq"]);
  setLang("ru");
  expect(t("att_late", { n: 12 })).toBe("опоздание 12 мин");
  setLang("uz");
  expect(t("att_late", { n: 12 })).toBe("12 daqiqa kechikdi");
});
```

- [ ] **Step 2: Запустить и убедиться, что падают**

Run: `cd /Users/macbookpro/development/managers-kpi/kpi_miniapp && bun test test/route.test.ts test/i18n.test.ts`
Expected: FAIL в обоих новых тестах (`parseHash` отдаёт главный экран, `DICT.ru.link_attendance` не определён).

- [ ] **Step 3: Реализовать.** `route.ts`: вариант union, `parseHash` распознаёт `/attendance` и `^/attendance/(\d{4})-(\d{2})$` с месяцем 01..12 (иначе главный экран, как у `review`), `hashOf` возвращает `#/attendance` при `month === null` и `#/attendance/<month>` иначе. `i18n.ts`: ключи из таблицы в `RU` (после `hist_upcoming`) и в `UZ` (после `hist_upcoming`).

- [ ] **Step 4: Запустить и убедиться, что проходят**

Run: `cd /Users/macbookpro/development/managers-kpi/kpi_miniapp && bun test`
Expected: все тесты зелёные (было 99). `bunx tsc --noEmit` до Task 5 краснеет на `screenOf` в `main.ts` (вариант `attendance` не обработан): это ожидаемо, закрывается в Task 5.

- [ ] **Step 5: Commit**

```bash
cd /Users/macbookpro/development/managers-kpi
git add kpi_miniapp/src/route.ts kpi_miniapp/src/i18n.ts kpi_miniapp/test/route.test.ts kpi_miniapp/test/i18n.test.ts
git commit -m "feat(kpi-app): маршрут #/attendance и тексты экрана посещаемости (ru, uz)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Модель вида посещаемости

**Files:**
- Create: `kpi_miniapp/src/view/attendance.ts`
- Test: Create `kpi_miniapp/test/view-attendance.test.ts`

**Interfaces:**
- Consumes: `TgAttendance`, `TgAttendanceDay` из `@backend/modules/kpi/tg-app/types` (Task 1); `hhmm(ms: number): string` из `../format` (по Ташкенту); `monthName(period: string, form: "nom" | "gen" | "prep", l: Lang)`, `tIn`, `Lang` из `../i18n` (`monthName` читает месяц из символов 5..7 строки, поэтому `YYYY-MM` подходит); `hashOf` из `../route`; `capFirst` из `../util`; ключи Task 3.
- Produces:

```ts
export interface AttendanceRowVM {
  day: string;                                  // «3 ноября» / «3-noyabr»
  absent: string | null;                        // «не вышел», только при absent = true
  times: { in: string; out: string } | null;    // «08:55» | «нет отметки» | «—»; у absent null
  late: string | null;                          // «опоздание 12 мин», только при late_minutes > 0 и не absent
}
export interface AttendanceNavVM { label: string; hash: string; aria: string } // label — название месяца: «Октябрь»
export interface AttendanceVM {
  title: string;                // «Моя посещаемость»
  month: string;                // «Ноябрь 2026»
  prev: AttendanceNavVM | null;
  next: AttendanceNavVM | null;
  empty: string | null;         // «Данных за месяц нет», когда days пуст
  rows: AttendanceRowVM[];      // в порядке ответа сервера
}
export function attendanceView(d: TgAttendance, l: Lang): AttendanceVM;
```

Правила: у `absent = true` строка получает `absent` и `times: null`, `late: null`. Иначе `times` строится из `hhmm(Date.parse(iso))`; недостающая отметка при наличии другой это `att_no_mark`; обе отсутствуют это «—» в обеих ячейках. Метка дня строится из строки `day` без `Date`, чтобы часовой пояс не сдвинул число: русский `${n} ${monthName(day, "gen", "ru")}`, узбекский `${n}-${monthName(day, "gen", "uz")}`. Ссылки `prev`/`next` ведут на `hashOf({ name: "attendance", month })`.

- [ ] **Step 1: Написать падающий тест** `kpi_miniapp/test/view-attendance.test.ts`:

```ts
import { expect, it } from "bun:test";
import type { TgAttendance, TgAttendanceDay } from "@backend/modules/kpi/tg-app/types";
import { attendanceView } from "../src/view/attendance";

const day = (o: Partial<TgAttendanceDay> & { day: string }): TgAttendanceDay => ({ check_in: null, check_out: null, late_minutes: 0, absent: false, ...o });
const month = (days: TgAttendanceDay[], o: Partial<TgAttendance> = {}): TgAttendance => ({ month: "2026-11", prev: "2026-10", next: null, days, ...o });

it("приход и уход по Ташкенту, опоздание только когда больше нуля", () => {
  const vm = attendanceView(
    month([
      day({ day: "2026-11-04", check_in: "2026-11-04T04:07:00.000Z", check_out: "2026-11-04T13:00:00.000Z", late_minutes: 12 }),
      day({ day: "2026-11-03", check_in: "2026-11-03T03:55:00.000Z", check_out: "2026-11-03T13:02:00.000Z", late_minutes: 0 }),
    ]),
    "ru",
  );
  expect(vm.title).toBe("Моя посещаемость");
  expect(vm.month).toBe("Ноябрь 2026");
  expect(vm.empty).toBeNull();
  expect(vm.rows).toEqual([
    { day: "4 ноября", absent: null, times: { in: "09:07", out: "18:00" }, late: "опоздание 12 мин" },
    { day: "3 ноября", absent: null, times: { in: "08:55", out: "18:02" }, late: null },
  ]);
});

it("«не вышел» только при absent = true: ни времён, ни опоздания, даже если они лежат в данных", () => {
  const vm = attendanceView(month([day({ day: "2026-11-05", absent: true, check_in: "2026-11-05T04:00:00.000Z", late_minutes: 30 })]), "ru");
  expect(vm.rows).toEqual([{ day: "5 ноября", absent: "не вышел", times: null, late: null }]);
});

it("приход без ухода — «нет отметки»; уход без прихода так же; отметок нет совсем — прочерки", () => {
  const vm = attendanceView(
    month([
      day({ day: "2026-11-06", check_in: "2026-11-06T04:00:00.000Z" }),
      day({ day: "2026-11-07", check_out: "2026-11-07T13:00:00.000Z" }),
      day({ day: "2026-11-08" }),
    ]),
    "ru",
  );
  expect(vm.rows.map((r) => r.times)).toEqual([
    { in: "09:00", out: "нет отметки" },
    { in: "нет отметки", out: "18:00" },
    { in: "—", out: "—" },
  ]);
});

it("ночной уход: 20:30 UTC это 01:30 по Ташкенту, день остаётся прежним", () => {
  const vm = attendanceView(
    month([day({ day: "2026-10-31", check_in: "2026-10-31T10:00:00.000Z", check_out: "2026-10-31T20:30:00.000Z" })], { month: "2026-10" }),
    "ru",
  );
  expect(vm.rows[0]).toEqual({ day: "31 октября", absent: null, times: { in: "15:00", out: "01:30" }, late: null });
});

it("пустой месяц: «Данных за месяц нет», переключатель остаётся; без соседей ссылок нет", () => {
  const vm = attendanceView(month([], { prev: "2026-08", next: "2026-12" }), "ru");
  expect([vm.empty, vm.rows]).toEqual(["Данных за месяц нет", []]);
  expect(vm.prev).toEqual({ label: "Август", hash: "#/attendance/2026-08", aria: "Предыдущий месяц" });
  expect(vm.next).toEqual({ label: "Декабрь", hash: "#/attendance/2026-12", aria: "Следующий месяц" });
  const none = attendanceView(month([day({ day: "2026-11-03" })], { prev: null }), "ru");
  expect([none.empty, none.prev, none.next]).toEqual([null, null, null]);
});

it("по-узбекски", () => {
  const vm = attendanceView(
    month([
      day({ day: "2026-11-04", check_in: "2026-11-04T04:07:00.000Z", check_out: "2026-11-04T13:00:00.000Z", late_minutes: 12 }),
      day({ day: "2026-11-05", absent: true }),
    ]),
    "uz",
  );
  expect([vm.title, vm.month]).toEqual(["Mening davomatim", "Noyabr 2026"]);
  expect(vm.rows.map((r) => [r.day, r.absent, r.late])).toEqual([["4-noyabr", null, "12 daqiqa kechikdi"], ["5-noyabr", "ishga chiqmadi", null]]);
  expect(attendanceView(month([]), "uz").empty).toBe("Oy uchun maʼlumot yoʻq");
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `cd /Users/macbookpro/development/managers-kpi/kpi_miniapp && bun test test/view-attendance.test.ts`
Expected: FAIL, `Cannot find module '../src/view/attendance'`.

- [ ] **Step 3: Реализовать `attendanceView`** в `kpi_miniapp/src/view/attendance.ts` по правилам и интерфейсам выше. Подпись месяца: `${capFirst(monthName(d.month, "nom", l))} ${d.month.slice(0, 4)}`; подпись соседа: `capFirst(monthName(m, "nom", l))`.

- [ ] **Step 4: Запустить и убедиться, что проходит**

Run: `cd /Users/macbookpro/development/managers-kpi/kpi_miniapp && bun test`
Expected: все тесты зелёные, включая 6 новых.

- [ ] **Step 5: Commit**

```bash
cd /Users/macbookpro/development/managers-kpi
git add kpi_miniapp/src/view/attendance.ts kpi_miniapp/test/view-attendance.test.ts
git commit -m "feat(kpi-app): модель вида «Моя посещаемость» (время по Ташкенту, нет отметки, не вышел)" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Экран, ссылка с главного, переключатель месяцев

В репозитории нет DOM-обвязки для тестов (экраны `screens/*` не покрыты, логика лежит в моделях `view/*`), поэтому падающего теста здесь нет: логику уже держит Task 4, а этот шаг проверяется сборкой и стендом.

**Files:**
- Create: `kpi_miniapp/src/screens/attendance.ts`
- Modify: `kpi_miniapp/src/main.ts` (импорты; `case "attendance"` в `screenOf` после `case "history"`; ветка в `navigate`)
- Modify: `kpi_miniapp/src/screens/home.ts` (строка-ссылка в `renderHome`)
- Modify: `kpi_miniapp/src/style.css` (блок `/* ---------- посещаемость ---------- */` после правила `.hist-empty`, перед комментарием `/* ---------- шторка спора ---------- */`)

**Interfaces:**
- Consumes: `AttendanceVM` и `attendanceView` (Task 4); `TgAttendance` (Task 1); `h` из `../ui`; `navigate` из `../nav`; `parseHash`, `hashOf` из `../route`; `t` из `../i18n`; ключи `att_in`, `att_out`, `att_empty` (через модель), `link_attendance` (Task 3).
- Produces: `renderAttendance(vm: AttendanceVM): HTMLElement` в `screens/attendance.ts`.

- [ ] **Step 1: Экран** `screens/attendance.ts`. Корень `main.screen.attendance` с `h1.title` (`vm.title`). Под ним переключатель: ссылка `prev` слева, подпись `vm.month` по центру, ссылка `next` справа; ссылка это `<a class="btn btn-quiet" href=hash aria-label=aria>` с текстом «‹ {label}» / «{label} ›» и тем же обработчиком, что `inAppLink` в `screens/history.ts` (`preventDefault`, `navigate(parseHash(hash))`); у отсутствующего соседа его место остаётся пустым, подпись месяца не смещается. Если `vm.empty` задан, ниже `p.card.hist-empty[role=status]` с этим текстом и больше ничего. Иначе `section.card.rows` с по строке `div.row.is-static > span.row-body` на день: слева `span.row-text` с днём и (если `times`) строкой «`t("att_in")` {in} · `t("att_out")` {out}» в `span.att-times`; справа `chip chip-warn` с `vm.absent` или `chip chip-wait` с `vm.late`, если они заданы. Все строки идут в DOM только через `h()`.

- [ ] **Step 2: Подключить в `main.ts`.** Импортировать `TgAttendance`, `renderAttendance`, `attendanceView` (в алфавитном порядке среди соседних импортов). В `screenOf` после `case "history"`:

```ts
    case "attendance":
      return {
        path: r.month ? `/attendance?month=${r.month}` : "/attendance",
        kind: "list",
        render: (d) => renderAttendance(attendanceView(d as TgAttendance, lang())),
        title: t("link_attendance"),
      };
```

В `navigate` сразу после проверки `if (same(to, top().route)) return;` добавить ветку замены (переключатель месяцев не копит шаги «назад»):

```ts
  if (to.name === "attendance" && top().route.name === "attendance") {
    stack[stack.length - 1] = { route: to, y: 0 };
    history.replaceState(null, "", hashOf(to));
    show(false);
    return;
  }
```

- [ ] **Step 3: Ссылка с главного.** В `renderHome` (`screens/home.ts`) перед `return` вычислить `const att = d.employee ? { text: t("link_attendance"), hash: hashOf({ name: "attendance", month: null }) } : null;` (импортировать `hashOf` вместе с `parseHash` из `../route`). Карточку `nav.card.rows` рисовать, когда есть `vm.links.length > 0` или `att`, и после строк `vm.links` добавить `linkRow(att.text, null, att.hash)`. `HomeVM`, `homeView` и тесты `view-home` не трогать.

- [ ] **Step 4: Стили.** В указанное место `style.css` добавить `.att-switch` (flex-строка, `align-items: center`, поля вместо `gap`, кнопки не уже `--tap`, подпись месяца по центру с `flex: 1` и весом 600) и `.att-times` (`font-variant-numeric: tabular-nums`, цвет `--muted`, размер `--fs-body`: `--fs-note` это 13 px, меньше 14). Цвета только через существующие переменные (`--muted`, `--ink`, `--well`), без новых токенов.

- [ ] **Step 5: Сборка и тесты**

Run: `cd /Users/macbookpro/development/managers-kpi/kpi_miniapp && bunx tsc --noEmit && bun test && bun --bun run build`
Expected: `tsc` без ошибок (красный `screenOf` из Task 3 закрыт), все тесты зелёные, в `dist` один `.js` и один `.css`.

- [ ] **Step 6: Проверка на стенде.** Поднять стенд по `docs/superpowers/kpi-handoff.md` (раздел про стенд «для глаз»: `managers_kpi_smoke`, `smoke-seed.ts`, backend на 6799, `KPI_DEV_API=http://localhost:6799 bun --bun run dev`). Для персоны 9100000001 вставить в `managers_kpi_smoke` через `psql` одну запись `kpi_attendance_imports` (`mapping = '{}'`) и строки `kpi_attendance` её сотрудника (`select employee_id from kpi_tg_bindings where telegram_id = 9100000001`): день с приходом и уходом, день с `late_minutes = 12`, день `absent = true`, день только с приходом, и по одному дню в предыдущем месяце. Ссылки: `cd kpi_miniapp && KPI_BOT_TOKEN=<тестовый токен стенда> bun scripts/dev-url.ts --tg <id> --route /attendance [--theme dark]`. Проверить:
  - 9100000001: на главном есть строка «Моя посещаемость»; экран показывает четыре вида строк; переключатель «‹ Месяц» и обратно работает, после двух переключений одно нажатие «Назад» возвращает на главный.
  - 9100000009 («Смоук Без карты»): ссылка на главном есть; экран пишет «Данных за месяц нет».
  - 9100000011 (оценщик без сотрудника): ссылки нет; адрес `--route /attendance` открывает главный экран.
  - Светлая и тёмная тема на 360 px: ничего не обрезано, подписи читаются, тач-цели не меньше 44 px.

- [ ] **Step 7: Commit**

```bash
cd /Users/macbookpro/development/managers-kpi
git add kpi_miniapp/src/screens/attendance.ts kpi_miniapp/src/main.ts kpi_miniapp/src/screens/home.ts kpi_miniapp/src/style.css
git commit -m "feat(kpi-app): экран «Моя посещаемость», ссылка с главного, переключатель месяцев" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review

- Покрытие спеки (пункт 6): экран «Моя посещаемость» с днями месяца, приходом, уходом, опозданием, «не вышел» (Task 4, 5); предыдущие месяцы переключателем (Task 1 `neighbours`, Task 2, Task 5); только дни со строкой (Task 2 читает только `kpi_attendance`, модель не достраивает дни); `absent = true` (Task 4); опоздание только при `> 0` (Task 4); «нет отметки» (Task 4); ссылка с главного и «Данных за месяц нет» (Task 3, 4, 5); данные только из существующей синхронизации, `WORKLY_ATTENDANCE_NIGHTLY` не тронут (Global Constraints, ни одна задача не касается `workly/`); новых прав и миграций нет; чужие строки не отдаются, тест в Task 2.
- Согласованность типов: `TgAttendance`/`TgAttendanceDay` объявлены в Task 1 и без изменений используются в Task 2 (ответ), Task 4 (вход модели) и Task 5 (приведение `d as TgAttendance`); месяц везде `YYYY-MM` (запрос, ответ, `Route.month`, хеш, путь `/attendance?month=`); `Route` из Task 3 (`month: string | null`) совпадает с вызовами `hashOf` в Task 4 и 5; ключи словаря из таблицы Task 3 ровно те, что читают Task 4 и 5.
- Пропорция: 5 задач, из них код в плане только у тестов, типов `types.ts`, интерфейсов модели и двух кусков точного копирования (`screenOf`, ветка `navigate`); реализации описаны подходом, потому что сигнатуры и тесты их определяют. Правка общих файлов добавляющая, якоря не в конце.
