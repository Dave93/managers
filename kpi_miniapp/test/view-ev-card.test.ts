import { expect, it } from "bun:test";
import type { EvCard, EvCardDay } from "@backend/modules/kpi/tg-app/ev-types";
import { absentStreak, daysInPeriod, evCardView, tashkentToday, weekdayOf } from "../src/view/ev-card";

const ID = "3f2b8c1e-5a4d-4e7f-9b21-0c6d8e9a1b23";
const day = (d: string, status: EvCardDay["status"], late = 0): EvCardDay => ({ day: d, status, late_minutes: late, check_in: status === "late" || status === "ontime" ? "08:12" : null, check_out: status === "late" || status === "ontime" ? "17:00" : null });
const card = (o: Partial<EvCard> = {}): EvCard => ({
  employee: { id: ID, first_name: "Шамсиддин", last_name: "Абдурахманов", position: "Повар", terminal_name: "Chopar pizza 40", tab_number: "1241", active: true, has_card: true },
  period: "2026-11-01",
  months: { prev: "2026-10-01", next: null },
  days: [day("2026-11-01", "ontime"), day("2026-11-02", "absent"), day("2026-11-03", "absent"), day("2026-11-04", "late", 12), day("2026-11-05", "dayoff")],
  review: null,
  violations: [],
  history: [],
  ...o,
});
// 10 ноября 2026, 12:00 по Ташкенту
const NOW = Date.parse("2026-11-10T12:00:00+05:00");

it("календарь: ноябрь 2026 начинается с воскресенья, 30 дней", () => {
  expect(daysInPeriod("2026-11-01")).toBe(30);
  expect(daysInPeriod("2028-02-01")).toBe(29);
  expect(weekdayOf("2026-11-01", 1)).toBe(6);
  expect(weekdayOf("2026-10-01", 1)).toBe(3);
  expect(tashkentToday(Date.parse("2026-11-10T20:30:00Z"))).toBe("2026-11-11");
  const a = evCardView(card(), "ru", NOW).att;
  expect(a.lead).toBe(6);
  expect(a.cells).toHaveLength(30);
  expect(a.weekdays).toEqual(["пн", "вт", "ср", "чт", "пт", "сб", "вс"]);
});

it("клетки: статусы, опоздание с минутами, сегодня и дальше — pending, прошлое без записи — empty", () => {
  const c = evCardView(card(), "ru", NOW).att.cells;
  expect(c.slice(0, 5).map((x) => x.state)).toEqual(["ontime", "absent", "absent", "late", "dayoff"]);
  expect(c[3]).toMatchObject({ badge: "+12", aria: "4 ноября, опоздание 12 мин" });
  expect(c[5]?.state).toBe("empty"); // 6 ноября, прошло, записи нет
  expect(c[8]?.state).toBe("empty"); // 9 ноября
  expect(c[9]?.state).toBe("pending"); // 10 ноября — сегодня
  expect(c[29]?.state).toBe("pending");
});

it("итоги: «Без отметки» считает только прошедшие дни; выходные видны, только если они есть", () => {
  const s = evCardView(card(), "ru", NOW).att.summary;
  expect(s.map((x) => [x.state, x.value])).toEqual([["ontime", 1], ["late", 1], ["absent", 2], ["dayoff", 1], ["none", 4]]);
  const noOff = evCardView(card({ days: [day("2026-11-01", "ontime")] }), "ru", NOW).att.summary;
  expect(noOff.map((x) => x.state)).toEqual(["ontime", "late", "absent", "none"]);
});

it("серия прогулов подряд: день без записи и другой статус рвут серию", () => {
  expect(absentStreak([day("2026-11-02", "absent"), day("2026-11-03", "absent"), day("2026-11-04", "absent")])).toBe(3);
  expect(absentStreak([day("2026-11-02", "absent"), day("2026-11-04", "absent")])).toBe(1);
  expect(absentStreak([day("2026-11-02", "absent"), day("2026-11-03", "ontime"), day("2026-11-04", "absent")])).toBe(1);
  expect(evCardView(card(), "ru", NOW).att.streak).toBe("Прогулов подряд: 2");
  expect(evCardView(card({ days: [day("2026-11-02", "absent")] }), "ru", NOW).att.streak).toBeNull();
});

it("отклонения: по порядку месяца, у опозданий время прихода и ухода", () => {
  const d = evCardView(card(), "ru", NOW).att.deviations;
  expect(d.map((x) => [x.day, x.weekday, x.text, x.tone])).toEqual([
    ["2 ноября", "пн", "не вышел", "bad"],
    ["3 ноября", "вт", "не вышел", "bad"],
    ["4 ноября", "ср", "опоздание 12 мин", "warn"],
    ["5 ноября", "чт", "Выходной", "info"],
  ]);
  expect(d[2]?.times).toBe("Приход 08:12 · Уход 17:00");
  expect(d[0]?.times).toBeNull();
});

it("нет записей за месяц — «Данных за месяц нет», числа вверху — прочерки", () => {
  const v = evCardView(card({ days: [] }), "ru", NOW);
  expect(v.att.empty).toBe("Данных за месяц нет");
  expect(v.figures.map((f) => f.value)).toEqual(["—", "—", "0"]);
});

it("шапка: имя, строка под ним, переключатель месяцев с годом у несоседнего", () => {
  const v = evCardView(card({ months: { prev: "2026-08-01", next: null } }), "ru", NOW);
  expect(v.name).toBe("Абдурахманов Шамсиддин");
  expect(v.sub).toBe("Повар · Chopar pizza 40 · Таб. № 1241");
  expect(v.month).toBe("Ноябрь 2026");
  expect(v.prev).toMatchObject({ label: "Август 2026", hash: `#/ev/card/${ID}/2026-08` });
  expect(v.next).toBeNull();
  expect(evCardView(card(), "ru", NOW).prev?.label).toBe("Октябрь");
  expect(evCardView(card({ employee: { ...card().employee, active: false } }), "ru", NOW).inactive).toBe("Не работает");
});

it("три числа и счётчик на вкладке нарушений считают только действующие", () => {
  const vio = (id: string, status: "active" | "cancelled") => ({ id, item_title_ru: "Опоздание", item_title_uz: "Kechikish", occurred_at: "2026-11-03T05:00:00.000Z", comment: "Без звонка", status });
  const v = evCardView(card({ violations: [vio("a", "active"), vio("b", "cancelled")] }), "ru", NOW);
  expect(v.figures.map((f) => [f.value, f.tone])).toEqual([["2", "bad"], ["1", "warn"], ["1", null]]);
  expect(v.tabs.map((t) => [t.value, t.count])).toEqual([["attendance", null], ["review", null], ["violations", 1], ["history", null]]);
  expect(v.violations.items.map((x) => x.cancelled)).toEqual([null, "отменено"]);
  expect(v.violations.items[0]).toMatchObject({ title: "Опоздание", date: "3 ноября", comment: "Без звонка" });
});

it("оценка: нет карты, нет оценки, есть оценка на языке интерфейса", () => {
  expect(evCardView(card({ employee: { ...card().employee, has_card: false } }), "ru", NOW).review.empty).toBe("Сотруднику не назначена карта оценки");
  expect(evCardView(card(), "ru", NOW).review.empty).toBe("Оценки за этот месяц нет");
  const r = { score_pct: 96.5, status: "ready" as const, items: [{ title_ru: "Чистота", title_uz: "Tozalik", score: 100, note: null }, { title_ru: "Скорость", title_uz: "", score: null, note: "нет данных" }] };
  const ru = evCardView(card({ review: r }), "ru", NOW).review;
  expect(ru).toMatchObject({ empty: null, score: "96,5 %", status: "Оценка готова" });
  expect(ru.items).toEqual([{ title: "Чистота", score: "100", note: null }, { title: "Скорость", score: "—", note: "нет данных" }]);
  expect(evCardView(card({ review: r }), "uz", NOW).review.items.map((i) => i.title)).toEqual(["Tozalik", "Скорость"]);
});

it("история: кварталы с месяцами и средним, суммы не показываются", () => {
  const h = [{ quarter_start: "2026-10-01", avg_pct: 92, months: [{ period: "2026-10-01", state: "scored" as const, score_pct: 92 }, { period: "2026-11-01", state: "pending" as const, score_pct: null }, { period: "2026-12-01", state: "upcoming" as const, score_pct: null }] }];
  const v = evCardView(card({ history: h }), "ru", NOW).history;
  expect(v.quarters[0]).toEqual({ title: "IV квартал 2026", months: [{ label: "Октябрь", value: "92,0 %" }, { label: "Ноябрь", value: "ещё не оценён" }, { label: "Декабрь", value: "—" }], avg: "92,0 %" });
  expect(JSON.stringify(v)).not.toMatch(/сум/);
});
