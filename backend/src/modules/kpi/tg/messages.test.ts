import { describe, expect, it } from "bun:test";
import * as M from "./messages";

const R = "11111111-2222-3333-4444-555555555555";
const V = "66666666-7777-8888-9999-000000000000";
const UNTIL = "2025-11-10T18:59:59.999Z";
const ETIROZ = "Eʼtiroz bildirish";
const ru = (until: string | null = UNTIL) => ({ lang: "ru" as const, disputeUntil: until });
const uz = (until: string | null = UNTIL) => ({ lang: "uz" as const, disputeUntil: until });
const SUB = { period: "2025-10-01", review_id: R, score_pct: 83.33 };

describe("форматы", () => {
  it("месяц, квартал, проценты, дата по Ташкенту, экранирование", () => {
    expect([M.monthLabel("2025-10-01", "ru"), M.monthLabel("2025-10-01", "uz")]).toEqual(["октябрь 2025", "2025-yil oktabr"]);
    expect([M.quarterLabel("2025-10-01", "ru"), M.quarterLabel("2025-10-01", "uz")]).toEqual(["IV квартал 2025", "2025-yil IV chorak"]);
    expect([M.fmtPct(83.33), M.fmtPct(94), M.fmtPct(90.5), M.fmtPct(null)]).toEqual(["83,33 %", "94 %", "90,50 %", "—"]);
    expect(M.fmtDateTime(UNTIL)).toBe("10.11.2025 23:59");
    expect(M.escapeHtml("<b>x</b> & y")).toBe("&lt;b&gt;x&lt;/b&gt; &amp; y");
  });
  it("ruPlural", () => {
    const f: [string, string, string] = ["сотрудник", "сотрудника", "сотрудников"];
    expect([1, 2, 5, 11, 21, 22, 112].map((n) => M.ruPlural(n, f))).toEqual(["сотрудник", "сотрудника", "сотрудников", "сотрудников", "сотрудник", "сотрудника", "сотрудников"]);
  });
});

describe("сотруднику", () => {
  it("review_submitted ru и uz с кнопкой", () => {
    expect(M.buildMessage("review_submitted", SUB, ru())).toEqual({
      text: "<b>Оценка за октябрь 2025</b>\nИтог: 83,33 %.\nНе согласны — нажмите «Оспорить» до 10.11.2025 23:59.",
      reply_markup: { inline_keyboard: [[{ text: "Оспорить", callback_data: `dispute:review:${R}` }]] },
    });
    expect(M.buildMessage("review_submitted", SUB, uz())).toEqual({
      text: `<b>2025-yil oktabr uchun baho</b>\nNatija: 83,33 %.\nRozi boʻlmasangiz, 10.11.2025 23:59 gacha «${ETIROZ}» tugmasini bosing.`,
      reply_markup: { inline_keyboard: [[{ text: ETIROZ, callback_data: `dispute:review:${R}` }]] },
    });
  });
  it("после срока спора нет ни строки, ни кнопки", () => {
    expect(M.buildMessage("review_submitted", SUB, ru(null))).toEqual({ text: "<b>Оценка за октябрь 2025</b>\nИтог: 83,33 %." });
  });
  it("review_changed: изменения, запасное русское название, экранирование", () => {
    const p = { period: "2025-10-01", review_id: R, score_pct: 90, version: 2, comment: "Ошибся <b>", changes: [
      { item_id: "a", title_ru: "Чистота кухни", title_uz: "Oshxona tozaligi", old: 50, new: 100 },
      { item_id: "b", title_ru: "Гигиена", old: null, new: 80 },
    ] };
    expect(M.buildMessage("review_changed", p, ru(null)).text).toBe("<b>Оценка за октябрь 2025 изменена</b>\nНовый итог: 90 %.\n• Чистота кухни: 50 → 100\n• Гигиена: — → 80\nКомментарий: Ошибся &lt;b&gt;");
    expect(M.buildMessage("review_changed", p, uz(null)).text).toBe("<b>2025-yil oktabr uchun baho oʻzgartirildi</b>\nYangi natija: 90 %.\n• Oshxona tozaligi: 50 → 100\n• Гигиена: — → 80\nIzoh: Ошибся &lt;b&gt;");
  });
  it("violation_recorded: без пункта, время по Ташкенту, кнопка по нарушению", () => {
    const p = { violation_id: V, period: "2025-10-01", item_title_ru: null, item_title_uz: null, occurred_at: "2025-10-15T07:00:00.000Z", comment: "Грязный пол" };
    expect(M.buildMessage("violation_recorded", p, ru())).toEqual({
      text: "<b>Зафиксировано нарушение</b>\nПункт: без пункта карты\nКогда: 15.10.2025 12:00\nКомментарий: Грязный пол\nНе согласны — нажмите «Оспорить» до 10.11.2025 23:59.",
      reply_markup: { inline_keyboard: [[{ text: "Оспорить", callback_data: `dispute:violation:${V}` }]] },
    });
    expect(Buffer.byteLength(`dispute:violation:${V}`)).toBeLessThanOrEqual(64);
  });
  it("violation_recorded старого формата: без «Когда», русское название", () => {
    expect(M.buildMessage("violation_recorded", { violation_id: V, period: "2025-10-01", item_title_ru: "Чистота кухни", comment: "x" }, uz(null)).text)
      .toBe("<b>Qoidabuzarlik qayd etildi</b>\nBand: Чистота кухни\nIzoh: x");
  });
  it("dispute_resolved: четыре исхода", () => {
    const b = { dispute_id: "d1", period: "2025-10-01", comment: "Проверили" };
    expect(M.buildMessage("dispute_resolved", { ...b, subject_type: "review", subject_id: R, decision: "accepted", score_pct: 95 }, ru(null)).text).toBe("<b>Спор по оценке за октябрь 2025 принят</b>\nНовый итог: 95 %.\nКомментарий: Проверили");
    expect(M.buildMessage("dispute_resolved", { ...b, subject_type: "review", subject_id: R, decision: "rejected" }, ru(null)).text).toBe("<b>Спор по оценке за октябрь 2025 отклонён</b>\nКомментарий: Проверили");
    expect(M.buildMessage("dispute_resolved", { ...b, subject_type: "violation", subject_id: V, decision: "accepted" }, uz(null)).text).toBe("<b>Qoidabuzarlik boʻyicha eʼtiroz qabul qilindi</b>\nQoidabuzarlik bekor qilindi.\nIzoh: Проверили");
    expect(M.buildMessage("dispute_resolved", { ...b, subject_type: "violation", subject_id: V, decision: "rejected" }, ru(UNTIL))).toEqual({ text: "<b>Спор по нарушению отклонён</b>\nНарушение остаётся.\nКомментарий: Проверили" });
  });
  it("raise_approved", () => {
    const p = { raise_id: "x", quarter_start: "2025-10-01", amount: 300000 };
    expect(M.buildMessage("raise_approved", p, ru(null)).text).toBe("<b>Повышение оклада: IV квартал 2025</b>\nРешение HR: +300 000 сум.");
    expect(M.buildMessage("raise_approved", p, uz(null)).text).toBe("<b>Maosh oshirilishi: 2025-yil IV chorak</b>\nHR qarori: +300 000 soʻm.");
    expect(M.buildMessage("raise_approved", { ...p, amount: 0 }, ru(null)).text).toBe("<b>Итоги квартала: IV квартал 2025</b>\nРешение HR: без повышения.");
  });
});

describe("оценщику и HR", () => {
  it("remind_evaluate", () => {
    const p = { period: "2025-10-01", pending: 5, deadline: "2025-11-07T18:59:59.999Z" };
    expect(M.buildMessage("remind_evaluate", p, ru(null)).text).toBe("<b>Оценки за октябрь 2025</b>\nЖдут вашей оценки: 5 сотрудников.\nСрок: 07.11.2025 23:59.");
    expect(M.buildMessage("remind_evaluate", p, uz(null)).text).toBe("<b>2025-yil oktabr baholari</b>\nBaho kutayotgan xodimlar: 5 ta.\nMuddat: 07.11.2025 23:59.");
    expect(M.buildMessage("remind_evaluate", { ...p, pending: 1 }, ru(null)).text).toContain("Ждут вашей оценки: 1 сотрудник.");
  });
  it("dispute_opened: имя экранируется, кнопки нет", () => {
    const m = M.buildMessage("dispute_opened", { dispute_id: "d1", subject_type: "violation", subject_id: V, period: "2025-10-01", employee_name: "Тест <Повар>", reason: "Я был на смене" }, ru());
    expect(m).toEqual({ text: "<b>Новый спор</b>\nСотрудник: Тест &lt;Повар&gt;\nПредмет: нарушение, октябрь 2025\nПричина: Я был на смене\nРазберите в админке: KPI → Споры." });
  });
  it("overdue_summary: 20 строк и «и ещё», пустая сводка", () => {
    const lagging = Array.from({ length: 25 }, (_, i) => ({ user_name: `Тест ${i + 1}`, pending: 2 }));
    const t = M.buildMessage("overdue_summary", { period: "2025-10-01", lagging, lagging_total: 30 }, ru(null)).text;
    expect(t.startsWith("<b>Срок оценок за октябрь 2025 прошёл</b>\nНе отправили оценки:\n• Тест 1 — 2\n")).toBe(true);
    expect(t.split("\n").filter((l) => l.startsWith("• Тест"))).toHaveLength(20);
    expect(t.endsWith("\n• …и ещё 10")).toBe(true);
    expect(M.buildMessage("overdue_summary", { period: "2025-10-01", lagging: [], lagging_total: 0 }, uz(null)).text)
      .toBe("<b>2025-yil oktabr: baholash muddati tugadi</b>\nBarcha baholovchilar baholarni yubordi.");
  });
});

describe("защита", () => {
  const samples: [string, Record<string, unknown>][] = [
    ["review_submitted", SUB],
    ["review_changed", { ...SUB, version: 2, comment: "c", changes: [{ item_id: "a", title_ru: "А", title_uz: "A", old: 1, new: 2 }] }],
    ["violation_recorded", { violation_id: V, period: "2025-10-01", item_title_ru: null, item_title_uz: null, occurred_at: UNTIL, comment: "c" }],
    ["dispute_resolved", { dispute_id: "d", subject_type: "review", subject_id: R, period: "2025-10-01", decision: "accepted", comment: "c", score_pct: 90 }],
    ["raise_approved", { raise_id: "x", quarter_start: "2025-10-01", amount: 1 }],
    ["remind_evaluate", { period: "2025-10-01", pending: 2, deadline: UNTIL }],
    ["dispute_opened", { dispute_id: "d", subject_type: "review", subject_id: R, period: "2025-10-01", employee_name: "Тест", reason: "r" }],
    ["overdue_summary", { period: "2025-10-01", lagging: [{ user_name: "Тест", pending: 1 }], lagging_total: 1 }],
  ];
  it("все восемь kind собираются; в узбекском нет ASCII-апострофа", () => {
    expect(samples.map(([k]) => k).sort()).toEqual([...M.KPI_KINDS].sort());
    for (const [k, p] of samples) {
      expect(M.buildMessage(k, p, ru()).text.length).toBeGreaterThan(0);
      expect(M.buildMessage(k, p, uz()).text).not.toMatch(/['`’]/);
    }
    for (const key of M.BOT_TEXT_KEYS) expect(M.botText(key, "uz", { min: 5 })).not.toMatch(/['`’]/);
  });
  it("неизвестный kind — UnknownKindError", () => {
    expect(() => M.buildMessage("weird", {}, ru())).toThrow(M.UnknownKindError);
  });
  it("кривой payload не роняет сборку; кнопка только при uuid", () => {
    const bad: Record<string, unknown>[] = [{}, { period: "x", quarter_start: 5, changes: null, lagging: "x", score_pct: "abc", amount: "abc", pending: null, occurred_at: "not-a-date", review_id: 1, violation_id: "v" }];
    for (const k of M.KPI_KINDS) for (const p of bad) for (const ctx of [ru(), uz(null)]) {
      expect(() => M.buildMessage(k, p, ctx)).not.toThrow();
    }
    expect(M.buildMessage("review_submitted", {}, ru()).reply_markup).toBeUndefined();
  });
  it("numeric строкой форматируется как число", () => {
    expect(M.buildMessage("raise_approved", { raise_id: "x", quarter_start: "2025-10-01", amount: "300000.00" }, ru(null)).text).toBe("<b>Повышение оклада: IV квартал 2025</b>\nРешение HR: +300 000 сум.");
    expect([M.fmtPct("83.33"), M.fmtSum("300000.00")]).toEqual(["83,33 %", "300 000"]);
  });
  it("длинный комментарий и длинные названия: не длиннее 4096, без разорванных сущностей", () => {
    const big = M.buildMessage("review_changed", { ...SUB, version: 2, comment: "<".repeat(5000),
      changes: Array.from({ length: 40 }, (_, i) => ({ item_id: `i${i}`, title_ru: "&".repeat(300), old: 1, new: 2 })) }, ru()).text;
    expect(big.length).toBeLessThanOrEqual(4096);
    expect(big).toContain("…");
    expect(big).not.toMatch(/&(?!amp;|lt;|gt;)/);
  });
});

describe("бот", () => {
  it("клавиатура языка и тексты", () => {
    expect(M.LANG_KEYBOARD).toEqual({ inline_keyboard: [[{ text: "Русский", callback_data: "lang:ru" }, { text: "Oʻzbekcha", callback_data: "lang:uz" }]] });
    for (const key of M.BOT_TEXT_KEYS) for (const l of ["ru", "uz"] as const) expect(M.botText(key, l, { min: 5 }).length).toBeGreaterThan(0);
    expect(M.botText("ask_reason", "ru", { min: 5 })).toBe("Напишите причину спора ответом на это сообщение, не короче 5 символов. Ждём 15 минут.");
    expect(M.botText("start_bad", "uz")).toBe(M.botText("start_bad", "ru"));
    expect(M.botText("err_rejected", "ru")).toBe("Спор уже отклонён. Повторно оспорить нельзя.");
    expect(M.botText("err_rejected", "uz")).toBe("Eʼtiroz allaqachon rad etilgan. Qayta eʼtiroz bildirib boʻlmaydi.");
  });
  it("start_ok называет, к кому привязан чат; имя экранируется и не разворачивает «$&»", () => {
    expect(M.botText("start_ok", "ru", { name: "Тест Повар" })).toBe(
      "Готово! Уведомления KPI будут приходить сюда.\nTayyor! KPI xabarlari shu yerga keladi.\n\n" +
        "Вы подключены как <b>Тест Повар</b>. Если это не вы — сообщите HR.\n" +
        "Siz <b>Тест Повар</b> sifatida ulandingiz. Agar bu siz boʻlmasangiz, HRga xabar bering.\n\n" +
        "Выберите язык / Tilni tanlang:"
    );
    expect(M.botText("start_ok", "uz", { name: "A" })).toContain("sifatida ulandingiz. Agar bu siz bo\u02BBlmasangiz, HRga xabar bering.");
    const evil = M.botText("start_ok", "ru", { name: "<i>$&</i> & {min}" });
    expect(evil).toContain("<b>&lt;i&gt;$&amp;&lt;/i&gt; &amp; {min}</b>");
    expect(evil).not.toContain("<i>");
    expect(M.botText("start_ok", "ru")).toContain("<b>—</b>");
  });
  it("start_ok_dual двуязычный: язык не влияет, имя подставляется", () => {
    const ru = M.botText("start_ok_dual", "ru", { name: "Тест" });
    expect(M.botText("start_ok_dual", "uz", { name: "Тест" })).toBe(ru);
    expect(ru).not.toMatch(/['`’]/);
    expect(ru.startsWith("Готово. Теперь здесь и ваши оценки, и напоминания оценщика.\n")).toBe(true);
    expect(ru).toContain("Вы подключены как <b>Тест</b>.");
    expect(ru).toContain("Siz <b>Тест</b> sifatida ulandingiz.");
  });
  it("joinMy склеивает части пустой строкой", () => {
    expect(M.joinMy(["a", "b"])).toBe("a\n\nb");
    expect(M.joinMy(["a"])).toBe("a");
  });
  it("/my сотрудника и оценщика", () => {
    expect(M.myEmployeeText("ru", [{ period: "2025-10-01", score_pct: 83.33 }, { period: "2025-09-01", score_pct: 90 }],
      [{ occurred_at: "2025-11-03T05:00:00.000Z", title_ru: "Чистота кухни", title_uz: "Oshxona tozaligi" }]))
      .toBe("<b>Ваши оценки</b>\n• октябрь 2025 — 83,33 %\n• сентябрь 2025 — 90 %\n\n<b>Нарушения в этом месяце</b>\n• 03.11.2025 Чистота кухни");
    expect(M.myEmployeeText("uz", [], [])).toBe("<b>Sizning baholaringiz</b>\nHozircha yuborilgan baho yoʻq.\n\n<b>Shu oydagi qoidabuzarliklar</b>\nBu oyda qoidabuzarlik yoʻq.");
    expect(M.myUserText("ru", "2025-10-01", 0, "2025-11-07T18:59:59.999Z")).toBe("<b>Оценки за октябрь 2025</b>\nВсе ваши сотрудники оценены.");
    expect(M.myUserText("ru", "2025-10-01", 2, "2025-11-07T18:59:59.999Z")).toBe("<b>Оценки за октябрь 2025</b>\nЖдут вашей оценки: 2 сотрудника.\nСрок: 07.11.2025 23:59.");
  });
});

describe("кнопка «Открыть»", () => {
  const APP = "https://x.test/kpi-app/";
  it("review_submitted: «Оспорить» первой строкой, «Открыть» второй", () => {
    expect(M.buildMessage("review_submitted", SUB, { ...ru(), appUrl: APP }).reply_markup).toEqual({ inline_keyboard: [
      [{ text: "Оспорить", callback_data: `dispute:review:${R}` }],
      [{ text: "Открыть", web_app: { url: `${APP}#/review/2025-10` } }],
    ] });
  });
  it("без срока спора — одна «Открыть»; uz — «Ochish»; у оценщика кнопки нет; без appUrl — как раньше", () => {
    expect(M.buildMessage("raise_approved", { raise_id: "x", quarter_start: "2025-10-01", amount: 1 }, { ...uz(null), appUrl: APP }).reply_markup)
      .toEqual({ inline_keyboard: [[{ text: "Ochish", web_app: { url: `${APP}#/history` } }]] });
    expect(M.buildMessage("remind_evaluate", { period: "2025-10-01", pending: 2, deadline: UNTIL }, { ...ru(), appUrl: APP }).reply_markup).toBeUndefined();
    expect(M.buildMessage("review_submitted", SUB, ru(null)).reply_markup).toBeUndefined();
  });
});
