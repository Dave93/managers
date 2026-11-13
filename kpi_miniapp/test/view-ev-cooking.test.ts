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
  summary: { orders: 4, on_time: 3, avg_wait_sec: 560, median_wait_sec: 540 },
  days: [
    { day: "2026-10-10", orders: 3, on_time: 2, avg_wait_sec: 500, median_wait_sec: 480 },
    { day: "2026-10-11", orders: 1, on_time: 1, avg_wait_sec: 700, median_wait_sec: 700 },
  ],
  dishes: [
    { name: "Пицца", qty: 9, avg_wait_sec: 533, over_pct: 55.6 },
    { name: "Паста", qty: 6, avg_wait_sec: 400, over_pct: 0 },
  ],
  min_qty: 5,
  scale: { floor: 80, target: 92 },
  data_issue: null,
  ...o,
});

it("ожидание: минуты и секунды на двух языках, целые минуты без секунд", () => {
  expect(waitText(500, "ru")).toBe("8 мин 20 с");
  expect(waitText(480, "ru")).toBe("8 мин");
  expect(waitText(500, "uz")).toBe("8 daq 20 s");
  expect(waitText(30, "ru")).toBe("0 мин 30 с");
});

it("итог: доля в норматив, «3 из 4», обычное ожидание (медиана); пояснение и пороги балла; доля ниже порога выделена", () => {
  const vm = evCookingView(data(), "ru");
  expect(vm.title).toBe("Абдурахманов Шамсиддин");
  expect(vm.sub).toBe("Chopar pizza 40 · Октябрь 2026");
  expect(vm.figures).toEqual([
    { label: "В норматив", value: `75,0${NBSP}%`, bad: true },
    { label: "Заказов в норматив", value: "3 из 4", bad: false },
    { label: "Обычно ждут", value: "9 мин", bad: false },
  ]);
  expect(vm.explain).toBe("Ожидание — время от открытия заказа до его готовности по данным iiko. Норматив: в зале до 8 мин, доставка до 12 мин.");
  expect(vm.scale).toBe("Подсказка балла: если в норматив больше 80 % заказов, филиал получает баллы; от 92 % — полный балл; 80 % и меньше — 0.");
  expect(vm.issue).toBeNull();
  expect(vm.empty).toBeNull();
  expect(vm.note).toContain("реже 5 раз");
});

it("дни: «2 из 3 в норматив», обычное ожидание дня, доля и полоска; ниже порога — выделено", () => {
  expect(evCookingView(data(), "ru").days.map((d) => [d.label, d.count, d.median, d.onTime, d.bar, d.bad])).toEqual([
    ["10 октября", "2 из 3 в норматив", "обычно 8 мин", `66,7${NBSP}%`, 67, true],
    ["11 октября", "1 из 1 в норматив", "обычно 11 мин 40 с", `100,0${NBSP}%`, 100, false],
  ]);
});

it("блюда: штуки, среднее ожидание заказов с блюдом, доля дольше нормы, пометка привычной долгой готовки", () => {
  const vm = evCookingView(data(), "ru");
  expect(vm.dishes[0]).toEqual({ name: "Пицца", qty: "9 шт.", avg: "8 мин 53 с", over: "дольше нормы: 55,6 %", slow: "чаще дольше нормы" });
  expect(vm.dishes[1]?.slow).toBeNull();
});

it("порог: ровно на пороге баллов нет (выделено); чуть ниже не округляется до порога; без показателя балла нет порогов и выделения", () => {
  const at = evCookingView(data({ days: [{ day: "2026-10-12", orders: 5, on_time: 4, avg_wait_sec: 400, median_wait_sec: 400 }] }), "ru");
  expect(at.days[0]).toMatchObject({ onTime: `80,0${NBSP}%`, bad: true });
  const above = evCookingView(data({ days: [{ day: "2026-10-12", orders: 6, on_time: 5, avg_wait_sec: 400, median_wait_sec: 400 }] }), "ru");
  expect(above.days[0]?.bad).toBe(false);
  const near = evCookingView(data({ summary: { orders: 2499, on_time: 1998, avg_wait_sec: 600, median_wait_sec: 600 } }), "ru");
  expect(near.figures[0]).toEqual({ label: "В норматив", value: `79,9${NBSP}%`, bad: true });
  const off = evCookingView(data({ scale: null }), "ru");
  expect(off.scale).toBeNull();
  expect(off.figures[0]?.bad).toBe(false);
  expect(off.days.every((d) => !d.bad)).toBe(true);
});

it("предупреждение о данных: нет кухни в iiko и слишком долгие замеры; без итога не показывается", () => {
  expect(evCookingView(data({ data_issue: "no_kitchen" }), "ru").issue).toContain("нет отдельной кухни");
  expect(evCookingView(data({ data_issue: "too_slow" }), "ru").issue).toContain("дольше двух нормативов");
  expect(evCookingView(data({ data_issue: "too_slow" }), "uz").issue).toContain("ikki normadan uzoq");
  expect(evCookingView(data({ data_issue: "no_kitchen", summary: null, days: [], dishes: [] }), "ru").issue).toBeNull();
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

it("узбекский: подписи, «… tadan … tasi», день с дефисом", () => {
  const vm = evCookingView(data(), "uz");
  expect(vm.figures[0]?.label).toBe("Normada");
  expect(vm.figures[1]?.value).toBe("4 tadan 3 tasi");
  expect(vm.days[0]?.label).toBe("10-oktabr");
  expect(vm.days[0]?.count).toBe("3 tadan 2 tasi normada");
  expect(vm.dishes[0]?.qty).toBe("9 dona");
});
