import { expect, it } from "bun:test";
import type { TgHistory, TgMonth } from "@backend/modules/kpi/tg-app/types";
import { historyView } from "../src/view/history";

const nb = "\u00a0";

const scored = (period: string, score_pct: number): TgMonth => ({ period, state: "scored", score_pct, opens_at: "2000-01-01T00:00:00.000Z" });
const month = (period: string, state: TgMonth["state"], opens_at = "2000-01-01T00:00:00.000Z"): TgMonth => ({ period, state, score_pct: null, opens_at });

// Шкала прибавки по возрастанию, как её отдаёт сервер.
const TIERS = [{ min_pct: 85, amount: 150000 }, { min_pct: 90, amount: 300000 }, { min_pct: 95, amount: 500000 }];

// Макет screens.html, экран 3: IV квартал идёт, III утверждён +500 000, II без прибавки.
function ex(): TgHistory {
  return {
    quarters: [
      {
        quarter_start: "2026-10-01",
        months: [
          scored("2026-10-01", 90.33),
          // 20 ноября 00:00 по Ташкенту — 19 ноября 19:00 UTC.
          month("2026-11-01", "upcoming", "2026-11-19T19:00:00.000Z"),
          month("2026-12-01", "upcoming", "2026-12-19T19:00:00.000Z"),
        ],
        avg_pct: 90.33,
        result: { kind: "running" },
      },
      {
        quarter_start: "2026-07-01",
        months: [scored("2026-07-01", 96), scored("2026-08-01", 95), scored("2026-09-01", 98)],
        avg_pct: 96.33,
        result: { kind: "decided", amount: 500000 },
      },
      {
        quarter_start: "2026-04-01",
        months: [scored("2026-04-01", 83.1), month("2026-05-01", "not_rated"), month("2026-06-01", "not_rated")],
        avg_pct: 83.1,
        result: { kind: "decided", amount: 0 },
      },
    ],
    tiers: TIERS,
  };
}

it("макет: кварталы, итоги, месяцы, средний, ссылки на «Вся оценка»", () => {
  const vm = historyView(ex(), "ru");
  expect(vm.empty).toBe(false);
  expect(vm.quarters.map((q) => q.title)).toEqual(["IV квартал 2026", "III квартал 2026", "II квартал 2026"]);
  expect(vm.quarters.map((q) => q.result)).toEqual([
    { text: "идёт", tone: "wait" },
    { text: `Утверждено +500${nb}000${nb}сум`, tone: "ok" },
    { text: "Без прибавки", tone: "muted" },
  ]);
  expect(vm.quarters[0]!.months).toEqual([
    { label: "Октябрь", value: `90,3${nb}%`, hash: "#/review/2026-10" },
    { label: "Ноябрь", value: "с 20 ноября", hash: null },
    { label: "Декабрь", value: "—", hash: null },
  ]);
  expect(vm.quarters[1]!.months.map((m) => m.value)).toEqual([`96,0${nb}%`, `95,0${nb}%`, `98,0${nb}%`]);
  expect(vm.quarters[1]!.months.map((m) => m.hash)).toEqual(["#/review/2026-07", "#/review/2026-08", "#/review/2026-09"]);
  expect(vm.quarters[1]!.avg).toBe(`96,3${nb}%`);
  expect(vm.quarters[2]!.avg).toBe(`83,1${nb}%`);
  expect(vm.quarters[2]!.months.map((m) => [m.value, m.hash])).toEqual([
    [`83,1${nb}%`, "#/review/2026-04"],
    ["не оценивался", null],
    ["не оценивался", null],
  ]);
});

it("месяц ждёт оценки — «ещё не оценён»; ждём HR; среднего нет", () => {
  const vm = historyView(
    {
      quarters: [
        {
          quarter_start: "2026-10-01",
          months: [month("2026-10-01", "pending", "2026-10-19T19:00:00.000Z"), month("2026-11-01", "upcoming", "2026-11-19T19:00:00.000Z"), month("2026-12-01", "upcoming")],
          avg_pct: null,
          result: { kind: "running" },
        },
        {
          quarter_start: "2026-07-01",
          months: [scored("2026-07-01", 96), scored("2026-08-01", 95), scored("2026-09-01", 98)],
          avg_pct: 96.33,
          result: { kind: "waiting_hr" },
        },
      ],
      tiers: TIERS,
    },
    "ru",
  );
  // Первый upcoming после pending всё равно первый: дата начала оценок (решение 9).
  expect(vm.quarters[0]!.months.map((m) => m.value)).toEqual(["ещё не оценён", "с 20 ноября", "—"]);
  expect(vm.quarters[0]!.avg).toBeNull();
  expect(vm.quarters[1]!.result).toEqual({ text: "Ждём решения HR", tone: "wait" });
});

it("узбекский", () => {
  const vm = historyView(ex(), "uz");
  expect(vm.quarters.map((q) => q.title)).toEqual(["2026-yil IV chorak", "2026-yil III chorak", "2026-yil II chorak"]);
  expect(vm.quarters.map((q) => q.result.text)).toEqual(["davom etmoqda", `Tasdiqlandi +500${nb}000${nb}soʻm`, "Oshirishsiz"]);
  expect(vm.quarters[0]!.months.map((m) => [m.label, m.value])).toEqual([
    ["Oktabr", `90,3${nb}%`],
    ["Noyabr", "20-noyabrdan"],
    ["Dekabr", "—"],
  ]);
  expect(vm.quarters[2]!.months[1]!.value).toBe("baholanmadi");
});

it("пустая история", () => {
  expect(historyView({ quarters: [], tiers: TIERS }, "ru")).toEqual({ quarters: [], empty: true });
});

it("порог ступени (решение 6): 89,96 при ступени 90 — «89,9» в месяце и в среднем, как на главном", () => {
  const h: TgHistory = {
    quarters: [
      {
        quarter_start: "2026-07-01",
        months: [scored("2026-07-01", 89.96), month("2026-08-01", "not_rated"), month("2026-09-01", "not_rated")],
        avg_pct: 89.96,
        result: { kind: "waiting_hr" },
      },
    ],
    tiers: TIERS,
  };
  const q = historyView(h, "ru").quarters[0]!;
  expect(q.months[0]!.value).toBe(`89,9${nb}%`);
  expect(q.avg).toBe(`89,9${nb}%`);
  // Ответ без шкалы (старый backend, копия из кэша) — обычное округление, без падения.
  const { tiers: _drop, ...noTiers } = h;
  expect(historyView(noTiers as TgHistory, "ru").quarters[0]!.avg).toBe(`90,0${nb}%`);
});
