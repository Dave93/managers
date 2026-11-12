import { expect, it } from "bun:test";
import type { EvCooking } from "@backend/modules/kpi/tg-app/ev-types";
import { evCookingView, waitText } from "../src/view/ev-cooking";

const ID = "3f2b8c1e-5a4d-4e7f-9b21-0c6d8e9a1b23";
const NBSP = " ";
const data = (o: Partial<EvCooking> = {}): EvCooking => ({
  employee: { id: ID, first_name: "Шамсиддин", last_name: "Абдурахманов", terminal_name: "Chopar pizza 40" },
  period: "2026-10-01",
  shift: null,
  shifts: true,
  norms: { hall_min: 8, delivery_min: 12 },
  summary: { orders: 4, on_time: 3, avg_wait_sec: 560 },
  days: [
    { day: "2026-10-10", orders: 3, on_time: 2, avg_wait_sec: 500 },
    { day: "2026-10-11", orders: 1, on_time: 1, avg_wait_sec: 700 },
  ],
  dishes: [
    { name: "Пицца", qty: 9, avg_wait_sec: 533, over_pct: 55.6 },
    { name: "Паста", qty: 6, avg_wait_sec: 400, over_pct: 0 },
  ],
  min_qty: 5,
  ...o,
});

it("ожидание: минуты и секунды на двух языках, целые минуты без секунд", () => {
  expect(waitText(500, "ru")).toBe("8 мин 20 с");
  expect(waitText(480, "ru")).toBe("8 мин");
  expect(waitText(500, "uz")).toBe("8 daq 20 s");
  expect(waitText(30, "ru")).toBe("0 мин 30 с");
});

it("шапка, три числа, норматив, дни и блюда", () => {
  const vm = evCookingView(data(), "ru");
  expect(vm.title).toBe("Абдурахманов Шамсиддин");
  expect(vm.sub).toBe("Chopar pizza 40 · Октябрь 2026");
  expect(vm.figures).toEqual([
    { label: "Заказов", value: "4" },
    { label: "Среднее ожидание", value: "9 мин 20 с" },
    { label: "В норматив", value: `75,0${NBSP}%` },
  ]);
  expect(vm.norms).toBe("Норматив: зал 8 мин, доставка 12 мин");
  expect(vm.days.map((d) => [d.label, d.avg, d.onTime, d.bar])).toEqual([
    ["10 октября", "8 мин 20 с", `66,7${NBSP}%`, 67],
    ["11 октября", "11 мин 40 с", `100,0${NBSP}%`, 100],
  ]);
  expect(vm.dishes[0]).toEqual({ name: "Пицца", qty: "9 шт.", avg: "8 мин 53 с", over: "дольше нормы: 55,6 %", slow: "чаще дольше нормы" });
  expect(vm.dishes[1]?.slow).toBeNull();
  expect(vm.empty).toBeNull();
  expect(vm.note).toContain("реже 5 раз");
});

it("переключатель смены: три ссылки на тот же экран, выбранная отмечена; без кассовых смен его нет", () => {
  const vm = evCookingView(data({ shift: "2" }), "ru");
  expect(vm.shifts?.map((s) => [s.label, s.hash, s.selected])).toEqual([
    ["Весь день", `#/ev/cooking/2026-10/${ID}`, false],
    ["1-я смена", `#/ev/cooking/2026-10/${ID}/1`, false],
    ["2-я смена", `#/ev/cooking/2026-10/${ID}/2`, true],
  ]);
  expect(evCookingView(data({ shifts: false }), "ru").shifts).toBeNull();
});

it("нет замеров: пустое состояние, у смены своя подпись; нет блюд при итоге — отдельная строка", () => {
  const none = evCookingView(data({ summary: null, days: [], dishes: [] }), "ru");
  expect(none.empty).toBe("За этот месяц замеров нет.");
  expect(none.figures).toEqual([]);
  expect(none.dishesEmpty).toBeNull();
  expect(evCookingView(data({ summary: null, days: [], dishes: [], shift: "1" }), "uz").empty).toBe("Bu smenada oʻlchovlar yoʻq.");
  expect(evCookingView(data({ dishes: [] }), "ru").dishesEmpty).toBe("Блюд с достаточным числом заказов нет.");
});

it("узбекский: подписи и день с дефисом", () => {
  const vm = evCookingView(data(), "uz");
  expect(vm.figures[0]?.label).toBe("Buyurtmalar");
  expect(vm.days[0]?.label).toBe("10-oktabr");
  expect(vm.dishes[0]?.qty).toBe("9 dona");
});
