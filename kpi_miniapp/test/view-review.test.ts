import { afterEach, expect, it } from "bun:test";
import type { TgReview, TgReviewItem } from "@backend/modules/kpi/tg-app/types";
import { setLang } from "../src/i18n";
import { disputeErrorText, reviewView } from "../src/view/review";

const nb = " ";

afterEach(() => setLang("ru"));

const item = (id: string, title_ru: string, score: number | null, o: Partial<TgReviewItem> = {}): TgReviewItem => ({
  item_id: id,
  title_ru,
  title_uz: `${title_ru} (uz)`,
  group_key: "base",
  score,
  source: "manual",
  note: null,
  ...o,
});

// Шкала прибавки по возрастанию, как её отдаёт сервер.
const TIERS = [{ min_pct: 85, amount: 150000 }, { min_pct: 90, amount: 300000 }, { min_pct: 95, amount: 500000 }];

// Макет screens.html, экран 1: октябрь 90,33 %, девять пунктов — семь основных и два дополнительных.
function ex(): TgReview {
  return {
    period: "2026-10-01",
    review_id: "r-1",
    score_pct: 90.33,
    status: "changed",
    submitted_at: "2026-10-25T07:00:00.000Z",
    items: [
      item("i-1", "Приход и уход", null, { source: "attendance", title_uz: "Kelish va ketish" }),
      item("i-2", "Чистота кухни", 100),
      item("i-3", "Гигиена сотрудника", 75, { note: "Форма была грязной 14 и 18 октября", title_uz: "Xodim gigiyenasi" }),
      item("i-4", "Скорость отдачи", 90, { source: "cooking_speed" }),
      item("i-5", "План продаж", 100, { source: "sales_plan" }),
      item("i-6", "Фудкост", 85, { source: "food_cost" }),
      item("i-7", "Соблюдение техкарты", 100),
      item("i-8", "Помощь коллегам", 100, { group_key: "extra" }),
      item("i-9", "Инициатива", 50, { group_key: "extra", title_uz: "" }),
    ],
    changes: [
      {
        at: "2026-10-27T07:00:00.000Z",
        old_score_pct: 85,
        new_score_pct: 90.33,
        comment: "Пересчитали гигиену",
        items: [
          { title_ru: "Гигиена сотрудника", title_uz: "Xodim gigiyenasi", old: 75, new: 100 },
          { title_ru: "Приход и уход", title_uz: "", old: 80, new: null },
        ],
      },
    ],
    dispute: { state: "can", deadline: "2026-11-10T18:59:59.999Z", opened_at: null, last_resolved: null },
    reason_min: 5,
    tiers: TIERS,
  };
}

it("макет: заголовок, группы, пункты, изменения, «Оспорить»", () => {
  const vm = reviewView(ex(), "ru");
  expect(vm.title).toBe(`Октябрь · 90,3${nb}%`);
  expect(vm.groups.map((g) => g.title)).toEqual(["Основные пункты", "Дополнительные пункты"]);
  expect(vm.groups.map((g) => g.items.length)).toEqual([7, 2]);
  expect(vm.groups[0]!.items[0]).toMatchObject({ title: "Приход и уход", score: "—", bar: null, source: "по данным Workly", noData: true });
  expect(vm.groups[0]!.items[2]).toEqual({
    title: "Гигиена сотрудника",
    score: "75",
    bar: 0.75,
    source: null,
    note: "Форма была грязной 14 и 18 октября",
    noData: false,
  });
  // Под итогом — пункты, как в сообщении бота; null — «нет данных».
  expect(vm.changes).toEqual([
    {
      line: `27 октября: 85,0${nb}% → 90,3${nb}%`,
      items: ["Гигиена сотрудника: 75 → 100", "Приход и уход: 80 → нет данных"],
      reason: "Причина: Пересчитали гигиену",
    },
  ]);
  expect(vm.resolved).toBeNull();
  expect(vm.dispute).toEqual({ can: true, label: "Оспорить" });
});

it("источник: Workly, балл филиала, ручной — без пометки", () => {
  const items = reviewView(ex(), "ru").groups[0]!.items;
  expect(items.map((x) => x.source)).toEqual(["по данным Workly", null, null, "по баллу филиала", "по баллу филиала", "по баллу филиала", null]);
  expect(reviewView(ex(), "uz").groups[0]!.items[3]!.source).toBe("filial bali boʻyicha");
});

it("баллы пунктов целые, полоска — доля от 100, у 100 — полная", () => {
  const r = ex();
  r.items[1] = item("i-2", "Чистота кухни", 87.6);
  const items = reviewView(r, "ru").groups[0]!.items;
  expect(items[1]).toMatchObject({ score: "88", noData: false });
  expect(items[1]!.bar).toBeCloseTo(0.876, 9);
  expect(items[4]).toMatchObject({ score: "100", bar: 1 });
});

it("пункт без балла сохраняет заметку оценщика", () => {
  const r = ex();
  r.items[0] = item("i-1", "Приход и уход", null, { source: "attendance", note: "Workly не работал" });
  expect(reviewView(r, "ru").groups[0]!.items[0]).toMatchObject({ score: "—", bar: null, note: "Workly не работал", noData: true });
});

it("пустая заметка — как её отсутствие", () => {
  const r = ex();
  r.items[1] = item("i-2", "Чистота кухни", 100, { note: "  " });
  expect(reviewView(r, "ru").groups[0]!.items[1]!.note).toBeNull();
});

it("без дополнительных пунктов — одна группа", () => {
  const r = ex();
  r.items = r.items.filter((x) => x.group_key === "base");
  expect(reviewView(r, "ru").groups.map((g) => g.title)).toEqual(["Основные пункты"]);
});

it("спор открыт — строка с датой, кнопки нет", () => {
  const r = ex();
  r.dispute = { state: "open", deadline: "2026-11-10T18:59:59.999Z", opened_at: "2026-10-27T07:00:00.000Z", last_resolved: null };
  expect(reviewView(r, "ru").dispute).toEqual({ can: false, line: "Вы оспорили оценку 27 октября. Ответ придёт в бот." });
  expect(reviewView(r, "uz").dispute).toEqual({ can: false, line: "Siz 27-oktabr kuni eʼtiroz bildirdingiz. Javob botga keladi." });
});

it("спор открыт без даты — «Спор на рассмотрении»", () => {
  const r = ex();
  r.dispute = { state: "open", deadline: "2026-11-10T18:59:59.999Z", opened_at: null, last_resolved: null };
  expect(reviewView(r, "ru").dispute).toEqual({ can: false, line: "Спор на рассмотрении" });
});

it("срок прошёл, месяц закрыт", () => {
  const r = ex();
  r.dispute = { state: "window_closed", deadline: "2026-11-10T18:59:59.999Z", opened_at: null, last_resolved: null };
  expect(reviewView(r, "ru").dispute).toEqual({ can: false, line: "Срок спора прошёл." });
  r.dispute = { state: "period_closed", deadline: "2026-11-10T18:59:59.999Z", opened_at: null, last_resolved: null };
  expect(reviewView(r, "ru").dispute).toEqual({ can: false, line: "Месяц закрыт, оспорить нельзя." });
});

it("спор отклонён — «Повторно оспорить нельзя.», кнопки нет; решение остаётся", () => {
  const r = ex();
  r.dispute = {
    state: "rejected",
    deadline: "2026-11-10T18:59:59.999Z",
    opened_at: null,
    last_resolved: { decision: "rejected", comment: "Проверили журнал смен", resolved_at: "2026-10-28T07:00:00.000Z" },
  };
  expect(reviewView(r, "ru").dispute).toEqual({ can: false, line: "Повторно оспорить нельзя." });
  expect(reviewView(r, "ru").resolved).toEqual({ title: "Спор отклонён", comment: "Комментарий: Проверили журнал смен" });
  expect(reviewView(r, "uz").dispute).toEqual({ can: false, line: "Qayta eʼtiroz bildirib boʻlmaydi." });
});

it("спор разобран: решение и комментарий", () => {
  const r = ex();
  r.dispute = {
    state: "window_closed",
    deadline: "2026-11-10T18:59:59.999Z",
    opened_at: null,
    last_resolved: { decision: "rejected", comment: "Проверили журнал смен", resolved_at: "2026-10-28T07:00:00.000Z" },
  };
  expect(reviewView(r, "ru").resolved).toEqual({ title: "Спор отклонён", comment: "Комментарий: Проверили журнал смен" });
  r.dispute.last_resolved = { decision: "accepted", comment: null, resolved_at: "2026-10-28T07:00:00.000Z" };
  expect(reviewView(r, "ru").resolved).toEqual({ title: "Спор принят", comment: null });
  expect(reviewView(r, "uz").resolved).toEqual({ title: "Eʼtiroz qabul qilindi", comment: null });
});

it("изменения: прочерк без «%» на месте пустого балла, без причины — null", () => {
  const r = ex();
  r.changes = [
    { at: "2026-10-27T07:00:00.000Z", old_score_pct: null, new_score_pct: 90.33, comment: null, items: [] },
    { at: "2026-10-28T07:00:00.000Z", old_score_pct: 90.33, new_score_pct: null, comment: "Пункт убрали", items: [] },
  ];
  expect(reviewView(r, "ru").changes).toEqual([
    { line: `27 октября: — → 90,3${nb}%`, items: [], reason: null },
    { line: `28 октября: 90,3${nb}% → —`, items: [], reason: "Причина: Пункт убрали" },
  ]);
});

it("оценка без балла — заголовок только с месяцем", () => {
  const r = ex();
  r.score_pct = null;
  expect(reviewView(r, "ru").title).toBe("Октябрь");
});

it("узбекский: месяц, группы, название пункта с запасным русским", () => {
  const vm = reviewView(ex(), "uz");
  expect(vm.title).toBe(`Oktabr · 90,3${nb}%`);
  expect(vm.groups.map((g) => g.title)).toEqual(["Asosiy bandlar", "Qoʻshimcha bandlar"]);
  expect(vm.groups[0]!.items[0]!.title).toBe("Kelish va ketish");
  expect(vm.groups[1]!.items[1]!.title).toBe("Инициатива");
  // Узбекского названия нет («») — русское, как у списка пунктов.
  expect(vm.changes[0]).toEqual({
    line: `27-oktabr: 85,0${nb}% → 90,3${nb}%`,
    items: ["Xodim gigiyenasi: 75 → 100", "Приход и уход: 80 → maʼlumot yoʻq"],
    reason: "Sabab: Пересчитали гигиену",
  });
  expect(vm.dispute).toEqual({ can: true, label: "Eʼtiroz bildirish" });
});

it("изменения: ответ без пунктов (старый backend, копия из кэша) — только итог и причина, без падения", () => {
  const r = ex();
  const { items: _drop, ...old } = r.changes[0]!;
  r.changes = [old as (typeof r.changes)[number]];
  expect(reviewView(r, "ru").changes).toEqual([{ line: `27 октября: 85,0${nb}% → 90,3${nb}%`, items: [], reason: "Причина: Пересчитали гигиену" }]);
});

it("порог ступени (решение 6): 89,96 при ступени 90 — «89,9» в заголовке и в изменениях, как на главном", () => {
  const r = { ...ex(), score_pct: 89.96, changes: [{ at: "2026-10-27T07:00:00.000Z", old_score_pct: 84.97, new_score_pct: 89.96, comment: null, items: [] }] };
  const vm = reviewView(r, "ru");
  expect(vm.title).toBe(`Октябрь · 89,9${nb}%`);
  expect(vm.changes[0]!.line).toBe(`27 октября: 84,9${nb}% → 89,9${nb}%`);
  // Ответ без шкалы (старый backend, копия из кэша) — обычное округление, без падения.
  const { tiers: _drop, ...noTiers } = r;
  expect(reviewView(noTiers as typeof r, "ru").title).toBe(`Октябрь · 90,0${nb}%`);
});

it("disputeErrorText: коды сервера, неизвестное и null — общее", () => {
  expect(disputeErrorText("comment_required", 5)).toBe("Слишком коротко: нужно не меньше 5 букв или цифр.");
  expect(disputeErrorText("dispute_window_closed", 5)).toBe("Срок спора прошёл.");
  expect(disputeErrorText("dispute_exists", 5)).toBe("Спор уже открыт.");
  expect(disputeErrorText("period_closed", 5)).toBe("Месяц закрыт.");
  expect(disputeErrorText("already_cancelled", 5)).toBe("Нарушение уже отменено.");
  expect(disputeErrorText("not_found", 5)).toBe("Запись не найдена.");
  expect(disputeErrorText("dispute_rejected", 5)).toBe("Спор уже отклонён. Повторно оспорить нельзя.");
  expect(disputeErrorText("weird", 5)).toBe("Не получилось. Попробуйте ещё раз.");
  expect(disputeErrorText(null, 5)).toBe("Не получилось. Попробуйте ещё раз.");
});

it("disputeErrorText на языке интерфейса", () => {
  setLang("uz");
  expect(disputeErrorText("comment_required", 10)).toBe("Juda qisqa: kamida 10 ta harf yoki raqam kerak.");
  expect(disputeErrorText("dispute_rejected", 10)).toBe("Eʼtiroz allaqachon rad etilgan. Qayta eʼtiroz bildirib boʻlmaydi.");
  expect(disputeErrorText("weird", 10)).toBe("Xatolik. Yana urinib koʻring.");
});
