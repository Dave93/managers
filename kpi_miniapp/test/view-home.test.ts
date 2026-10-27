import { expect, it } from "bun:test";
import type { TgHome } from "@backend/modules/kpi/tg-app/types";
import { homeView } from "../src/view/home";

const nb = "\u00a0";
const NOW = Date.UTC(2026, 9, 26, 5);

// Макет 1 (home-layout-v3.html, слева): оценён октябрь, первый месяц квартала.
function ex1(): TgHome {
  return {
    lang: "ru",
    roles: ["employee"],
    evaluator: null,
    employee: {
      first_name: "Тест",
      last_name: "Повар",
      position_ru: "Повар",
      position_uz: "Oshpaz",
      terminal_name: "Тест Филиал 1",
      has_card: true,
      pending: null,
      month: {
        period: "2026-10-01",
        review_id: "r-1",
        score_pct: 90.33,
        status: "ready",
        dispute: { state: "can", deadline: "2026-11-10T18:59:59.999Z", opened_at: null, last_resolved: null },
        lost: [
          { item_id: "i-3", title_ru: "Гигиена сотрудника", title_uz: "Xodim gigiyenasi", score: 75 },
          { item_id: "i-6", title_ru: "Соблюдение техкарты", title_uz: "Texkartaga rioya", score: 75 },
        ],
      },
      raise: {
        quarter_start: "2026-10-01",
        tiers: [
          { min_pct: 85, amount: 150000 },
          { min_pct: 90, amount: 300000 },
          { min_pct: 95, amount: 500000 },
        ],
        avg_pct: 90.33,
        months: [
          { period: "2026-10-01", state: "scored", score_pct: 90.33, opens_at: "2026-10-19T19:00:00.000Z" },
          { period: "2026-11-01", state: "upcoming", score_pct: null, opens_at: "2026-11-19T19:00:00.000Z" },
          { period: "2026-12-01", state: "upcoming", score_pct: null, opens_at: "2026-12-19T19:00:00.000Z" },
        ],
        // EX1 из задачи 2
        hint: { kind: "too_few", scored: 1, min_months: 2, keep_periods: ["2026-10-01"], amount: 300000,
          next: { amount: 500000, reachable: true, need_pct: 97.4, periods: ["2026-11-01", "2026-12-01"] } },
      },
      violations: { period: "2026-10-01", count: 1 },
      has_history: true,
    },
  };
}

// Ноябрь — отчётный и ещё не оценён; главный оценённый — октябрь. Строка нарушений, как
// на сервере (home.ts: vPeriod = month?.period ?? R), остаётся за октябрём из ex1().
function withPending(): TgHome {
  const d = ex1();
  d.employee!.pending = { period: "2026-11-01", submit_opens_at: "2026-11-19T19:00:00.000Z", review_deadline: "2026-12-07T18:59:59.999Z", violations: 2 };
  return d;
}

function evaluatorOnly(pending: number): TgHome {
  return {
    lang: "ru",
    roles: ["evaluator"],
    evaluator: { period: "2026-10-01", pending, review_deadline: "2026-11-07T18:59:59.999Z", admin_url: "http://localhost:6762/ru/kpi/reviews" },
    employee: null,
  };
}

it("макет 1: шапка, месяц, прибавка, строки-ссылки", () => {
  const vm = homeView(ex1(), "ru", NOW);
  expect(vm.header).toEqual({ initials: "ТП", name: "Тест Повар", sub: "Повар · Тест Филиал 1" });
  expect(vm.evaluator).toBeNull();
  expect(vm.pending).toBeNull();
  expect(vm.noCard).toBe(false);
  expect(vm.month).toMatchObject({ title: "Октябрь", chip: { text: "Оценка готова", tone: "ok" }, score: "90,3",
    disputeLine: "Оспорить можно до 10 ноября.", lost: [{ title: "Гигиена сотрудника", score: "75" }, { title: "Соблюдение техкарты", score: "75" }], lostNone: false, hash: "#/review/2026-10" });
  expect(vm.raise!.title).toBe("Прибавка за IV квартал");
  expect(vm.raise!.badge).toEqual({ text: "предварительно", tone: "prelim" });
  expect(vm.raise!.ticks.map((x) => [x.pct, x.amount, x.at])).toEqual([[`85${nb}%`, `150${nb}тыс`, 0.25], [`90${nb}%`, `300${nb}тыс`, 0.5], [`95${nb}%`, `500${nb}тыс`, 0.75]]);
  expect(vm.raise!.marker!.label).toBe(`90,3${nb}%`);
  expect(vm.raise!.marker!.at).toBeCloseTo(0.5165, 6);
  expect(vm.raise!.months).toEqual([{ label: "Октябрь", value: "90,3", current: true }, { label: "Ноябрь", value: "с 20.11", current: false }, { label: "Декабрь", value: "—", current: false }]);
  expect(vm.raise!.lines).toEqual(["Оценён 1 месяц из 3, а прибавку считают от 2.",
    `Держите уровень октября — выйдет 300${nb}000${nb}сум.`, `Для 500${nb}000${nb}сум — в среднем 97,4${nb}% за ноябрь и декабрь.`]);
  expect(vm.links).toEqual([{ text: "Нарушения в октябре", count: "1", hash: "#/violations/2026-10" }, { text: "История", count: null, hash: "#/history" }]);
});

it("спор открыт: чип warn и строка с датой", () => {
  const d = ex1();
  d.employee!.month!.status = "dispute_open";
  d.employee!.month!.dispute = { state: "open", deadline: "2026-12-10T18:59:59.999Z", opened_at: "2026-11-27T06:00:00.000Z", last_resolved: null };
  expect(homeView(d, "ru", NOW).month).toMatchObject({ chip: { text: "Спор на рассмотрении", tone: "warn" }, disputeLine: "Вы оспорили оценку 27 ноября. Ответ придёт в бот." });
});

it("срок спора прошёл, месяц закрыт, прочие статусы — тон wait", () => {
  const d = ex1();
  d.employee!.month!.dispute.state = "window_closed";
  expect(homeView(d, "ru", NOW).month!.disputeLine).toBe("Срок спора прошёл.");
  d.employee!.month!.dispute.state = "period_closed";
  d.employee!.month!.status = "changed";
  expect(homeView(d, "ru", NOW).month).toMatchObject({ chip: { text: "Изменена", tone: "wait" }, disputeLine: "Месяц закрыт, оспорить нельзя." });
});

it("спор отклонён: «Оспорить можно до …» нет, вместо неё «Повторно оспорить нельзя.»", () => {
  const d = ex1();
  d.employee!.month!.status = "dispute_resolved";
  d.employee!.month!.dispute = {
    state: "rejected",
    deadline: "2026-11-10T18:59:59.999Z",
    opened_at: null,
    last_resolved: { decision: "rejected", comment: null, resolved_at: "2026-10-28T07:00:00.000Z" },
  };
  const m = homeView(d, "ru", NOW).month!;
  expect(m).toMatchObject({ chip: { text: "Спор разобран", tone: "wait" }, disputeLine: "Повторно оспорить нельзя." });
  expect(m.disputeLine).not.toContain("Оспорить можно");
  expect(homeView(d, "uz", NOW).month!.disputeLine).toBe("Qayta eʼtiroz bildirib boʻlmaydi.");
});

it("все пункты на максимуме — lostNone", () => {
  const d = ex1();
  d.employee!.month!.lost = [];
  expect(homeView(d, "ru", NOW).month).toMatchObject({ lost: [], lostNone: true });
});

it("балла нет — прочерк и никакого «все на максимуме»", () => {
  // Сервер без балла всегда шлёт lost: [] (lostItems отбрасывает пункты без балла), а
  // «Все пункты на максимуме» по спеке 4.1 — только когда все пункты на 100.
  const d = ex1();
  d.employee!.month!.score_pct = null;
  d.employee!.month!.lost = [];
  expect(homeView(d, "ru", NOW).month).toMatchObject({ score: "—", lost: [], lostNone: false });
});

it("больше трёх потерь — первые три, баллы целыми", () => {
  const d = ex1();
  d.employee!.month!.lost = [50, 60, 70, 80].map((s, i) => ({ item_id: `i${i}`, title_ru: `П${i}`, title_uz: `B${i}`, score: s + 0.4 }));
  expect(homeView(d, "ru", NOW).month!.lost).toEqual([{ title: "П0", score: "50" }, { title: "П1", score: "60" }, { title: "П2", score: "70" }]);
});

it("порог ступени: балл месяца и плитка не дотягивают до ступени, как и средний (решение 6)", () => {
  const d = ex1();
  d.employee!.month!.score_pct = 89.96;
  d.employee!.raise!.months[0]!.score_pct = 89.96;
  d.employee!.raise!.avg_pct = 89.96;
  const vm = homeView(d, "ru", NOW);
  expect([vm.month!.score, vm.raise!.months[0]!.value, vm.raise!.marker!.label]).toEqual(["89,9", "89,9", `89,9${nb}%`]);
  // Без карты прибавки порогов нет — обычное округление.
  d.employee!.raise = null;
  expect(homeView(d, "ru", NOW).month!.score).toBe("90,0");
});

it("неоценённый отчётный месяц: до открытия оценок и после", () => {
  const before = homeView(withPending(), "ru", NOW).pending;
  expect(before).toEqual({ title: "Ноябрь ещё не оценён", when: "Оценку поставят с 20 ноября.", violations: "Нарушений в ноябре: 2", hash: "#/violations/2026-11" });
  const after = homeView(withPending(), "ru", Date.UTC(2026, 10, 25, 5));
  expect(after.pending!.when).toBe("Оценку поставят до 7 декабря.");
  // Текущий в строке квартала — отчётный месяц (решение 9), а не оценённый октябрь.
  expect(after.raise!.months.map((m) => m.current)).toEqual([false, true, false]);
  // Нижняя строка нарушений — за главный оценённый месяц, карточка — за отчётный.
  expect(after.links[0]).toEqual({ text: "Нарушения в октябре", count: "1", hash: "#/violations/2026-10" });
});

it("оценщик: склонение, все оценены, ссылка", () => {
  expect(homeView(evaluatorOnly(1), "ru", NOW).evaluator).toEqual({ text: "Нужно оценить 1 сотрудника до 7 ноября", link: "http://localhost:6762/ru/kpi/reviews" });
  expect(homeView(evaluatorOnly(5), "ru", NOW).evaluator!.text).toBe("Нужно оценить 5 сотрудников до 7 ноября");
  expect(homeView(evaluatorOnly(0), "ru", NOW).evaluator!.text).toBe("Все ваши сотрудники оценены");
  expect(homeView(evaluatorOnly(5), "uz", NOW).evaluator!.text).toBe("7-noyabr gacha 5 ta xodimni baholash kerak");
  const vm = homeView(evaluatorOnly(1), "ru", NOW);
  expect([vm.header, vm.month, vm.raise, vm.pending, vm.links, vm.noCard]).toEqual([null, null, null, null, [], false]);
  const noLink = evaluatorOnly(2);
  noLink.evaluator!.admin_url = null;
  expect(homeView(noLink, "ru", NOW).evaluator!.link).toBeNull();
});

it("нет карты: карточек нет, история — если есть", () => {
  const d = ex1();
  d.employee!.has_card = false;
  d.employee!.month = null;
  d.employee!.raise = null;
  const vm = homeView(d, "ru", NOW);
  expect([vm.noCard, vm.month, vm.raise, vm.pending]).toEqual([true, null, null, null]);
  expect(vm.links).toEqual([{ text: "История", count: null, hash: "#/history" }]);
  d.employee!.has_history = false;
  expect(homeView(d, "ru", NOW).links).toEqual([]);
});

it("история без has_history — только при оценённом месяце", () => {
  const d = ex1();
  d.employee!.has_history = false;
  expect(homeView(d, "ru", NOW).links.map((l) => l.text)).toEqual(["Нарушения в октябре", "История"]);
  d.employee!.month = null;
  expect(homeView(d, "ru", NOW).links.map((l) => l.text)).toEqual(["Нарушения в октябре"]);
});

it("шапка: пустые части подписи выпадают", () => {
  const d = ex1();
  // Узбекской должности нет — русская, как у названий пунктов.
  d.employee!.position_uz = null;
  expect(homeView(d, "uz", NOW).header!.sub).toBe("Повар · Тест Филиал 1");
  d.employee!.position_ru = null;
  expect(homeView(d, "ru", NOW).header!.sub).toBe("Тест Филиал 1");
  d.employee!.terminal_name = null;
  expect(homeView(d, "ru", NOW).header!.sub).toBe("");
});

it("макет 1 по-узбекски", () => {
  const vm = homeView(ex1(), "uz", NOW);
  expect(vm.month!.chip.text).toBe("Baho tayyor");
  expect(vm.month!.lost[0]!.title).toBe("Xodim gigiyenasi");
  expect(vm.header!.sub).toBe("Oshpaz · Тест Филиал 1");
  expect(vm.links[0]!.text).toBe("Oktabrdagi qoidabuzarliklar");
  expect(vm.raise!.marker!.label).toBe(`90,3${nb}%`);
  expect(vm.raise!.title).toBe("IV chorak: maosh oshirilishi");
  expect(vm.raise!.ticks[0]!.amount).toBe(`150${nb}ming`);
  expect(vm.raise!.months[1]!.value).toBe(`20.11 dan`);
});

it("прибавка: квартал без оценок, не оценён, не оценивался, решение", () => {
  const d = ex1();
  const r = d.employee!.raise!;
  r.avg_pct = null;
  r.hint = { kind: "none" };
  r.months = [
    { period: "2026-07-01", state: "not_rated", score_pct: null, opens_at: "2026-07-19T19:00:00.000Z" },
    { period: "2026-08-01", state: "pending", score_pct: null, opens_at: "2026-08-19T19:00:00.000Z" },
    { period: "2026-09-01", state: "upcoming", score_pct: null, opens_at: "2026-09-19T19:00:00.000Z" },
  ];
  const vm = homeView(d, "ru", NOW);
  expect(vm.raise!.marker).toBeNull();
  expect(vm.raise!.months.map((m) => m.value)).toEqual(["не оценивался", "не оценён", "с 20.09"]);
  expect(vm.raise!.lines).toEqual(["Оценок в этом квартале ещё нет."]);
  r.hint = { kind: "decided", amount: 500000 };
  expect(homeView(d, "ru", NOW).raise).toMatchObject({ badge: { text: `Утверждено: +500${nb}000${nb}сум`, tone: "ok" }, lines: [] });
});

it("шкала: дробный порог с десятичной, средний не переходит ступень", () => {
  const d = ex1();
  const r = d.employee!.raise!;
  r.tiers = [{ min_pct: 90, amount: 300000 }, { min_pct: 87.5, amount: 150000 }, { min_pct: 95, amount: 1500000 }];
  r.avg_pct = 89.96;
  const raise = homeView(d, "ru", NOW).raise!;
  // по возрастанию порога, даже если сервер прислал иначе
  expect(raise.ticks.map((x) => [x.pct, x.amount, x.at])).toEqual([[`87,5${nb}%`, `150${nb}тыс`, 0.25], [`90${nb}%`, `300${nb}тыс`, 0.5], [`95${nb}%`, `1,5${nb}млн`, 0.75]]);
  expect(raise.marker!.label).toBe(`89,9${nb}%`);
});

// Отчётный месяц не оценён, а оценённого прошлого нет (руководитель, персона 12): сервер шлёт
// строку нарушений за тот же отчётный месяц, что и короткая карточка. Две строки, ведущие на один
// экран, — лишние: нижней нет, нарушения — в короткой карточке.
it("короткая карточка и нижняя строка за один месяц — нижней строки нарушений нет", () => {
  const d = withPending();
  d.employee!.month = null;
  d.employee!.violations = { period: "2026-11-01", count: 2 };
  const vm = homeView(d, "ru", NOW);
  expect(vm.pending!.hash).toBe("#/violations/2026-11");
  expect(vm.links).toEqual([{ text: "История", count: null, hash: "#/history" }]);
  d.employee!.has_history = false;
  expect(homeView(d, "ru", NOW).links).toEqual([]);
  // Месяцы разные (есть оценённый прошлый) — обе строки остаются.
  expect(homeView(withPending(), "ru", NOW).links.map((x) => x.hash)).toEqual(["#/violations/2026-10", "#/history"]);
});
