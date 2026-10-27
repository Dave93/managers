import { expect, it } from "bun:test";
import type { BotApi, MenuButton, TgResult } from "./bot-api";
import { applyMenuPlan, menuPlan, syncMenuButton } from "./menu";
import { appRoute, miniAppUrl } from "./miniapp-url";

const URL_ = "https://x.test/kpi-app/";
const WEB_RU: MenuButton = { type: "web_app", text: "Мой KPI", web_app: { url: URL_ } };
const WEB_UZ: MenuButton = { type: "web_app", text: "Mening KPI", web_app: { url: URL_ } };
const DEFAULT: MenuButton = { type: "default" };

// Подмена Bot API для кнопки меню: answer решает, что ответить на вызов чата (или бросить).
function menuApi(answer: (chatId: number | null) => TgResult = () => ({ ok: true, message_id: null })) {
  const calls: { chatId: number | null; button: MenuButton }[] = [];
  const api: BotApi = {
    async send() { return { ok: true, message_id: 1 }; },
    async answerCallback() { return { ok: true, message_id: null }; },
    async setMenuButton(chatId, button) {
      calls.push({ chatId, button });
      return answer(chatId);
    },
  };
  return { api, calls };
}

function withUrl<T>(v: string | undefined, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.KPI_MINIAPP_URL;
  if (v === undefined) delete process.env.KPI_MINIAPP_URL; else process.env.KPI_MINIAPP_URL = v;
  return fn().finally(() => { if (saved === undefined) delete process.env.KPI_MINIAPP_URL; else process.env.KPI_MINIAPP_URL = saved; });
}

it("menuPlan: глобальная русская первой, узбекским чатам своя, русские чаты — на кнопку по умолчанию, без повторов", () => {
  const plan = menuPlan([
    { telegram_id: 3, lang: "uz" }, { telegram_id: 1, lang: "ru" }, { telegram_id: 2, lang: "uz" }, { telegram_id: 2, lang: "uz" },
    { telegram_id: 5, lang: "ru" }, { telegram_id: 1, lang: "ru" },
    // у одного telegram_id обе строки (языки разошлись): чат один, узбекская кнопка
    { telegram_id: 4, lang: "ru" }, { telegram_id: 4, lang: "uz" },
  ], URL_);
  expect(plan).toEqual([
    { chatId: null, button: WEB_RU },
    { chatId: 2, button: WEB_UZ }, { chatId: 3, button: WEB_UZ }, { chatId: 4, button: WEB_UZ },
    { chatId: 1, button: DEFAULT }, { chatId: 5, button: DEFAULT },
  ]);
  // кнопка по умолчанию без chat_id стёрла бы глобальную: default бывает только у конкретного чата
  expect(plan.filter((s) => s.button.type === "default").every((s) => s.chatId !== null)).toBe(true);
  expect(menuPlan([], URL_)).toEqual([{ chatId: null, button: WEB_RU }]);
});

it("syncMenuButton: uz — своя кнопка, ru — кнопка по умолчанию; без адреса Telegram не зовётся", async () => {
  await withUrl(URL_, async () => {
    const f = menuApi();
    await syncMenuButton(f.api, 7, "uz");
    await syncMenuButton(f.api, 7, "ru");
    expect(f.calls).toEqual([{ chatId: 7, button: WEB_UZ }, { chatId: 7, button: DEFAULT }]);
  });
  await withUrl(undefined, async () => {
    const f = menuApi();
    await syncMenuButton(f.api, 7, "ru");
    await syncMenuButton(f.api, 7, "uz");
    expect(f.calls).toEqual([]);
  });
});

it("applyMenuPlan: по очереди, каждая неудача с причиной и без токена, итог по видам", async () => {
  const TOKEN = "987654:menu-secret-token";
  const f = menuApi((chatId) => {
    if (chatId === 2) return { ok: false, permanent: true, error: `Bad Request: chat not found (bot${TOKEN})` };
    if (chatId === 5) throw new Error(`fetch https://api.telegram.org/bot${TOKEN}/setChatMenuButton failed`);
    return { ok: true, message_id: null };
  });
  const info: string[] = [];
  const error: string[] = [];
  const plan = menuPlan([{ telegram_id: 3, lang: "uz" }, { telegram_id: 2, lang: "uz" }, { telegram_id: 1, lang: "ru" }, { telegram_id: 5, lang: "ru" }], URL_);
  const ok = await applyMenuPlan(f.api, plan, TOKEN, { info: (s) => info.push(s), error: (s) => error.push(s) });
  expect(ok).toBe(true);
  expect(f.calls.map((c) => c.chatId)).toEqual([null, 2, 3, 1, 5]);
  expect(error).toEqual([
    "kpi menu: chat 2 (uz) fail: Bad Request: chat not found (bot***)",
    "kpi menu: chat 5 (ru) fail: fetch https://api.telegram.org/bot***/setChatMenuButton failed",
  ]);
  expect(info).toEqual(["kpi menu: default ok, uz chats 1/2, ru chats 1/2"]);
  expect(JSON.stringify([info, error])).not.toContain(TOKEN);
});

it("applyMenuPlan: кнопка по умолчанию не встала — false и причина", async () => {
  const TOKEN = "987654:menu-secret-token";
  const f = menuApi((chatId) => (chatId === null ? { ok: false, permanent: true, error: `Unauthorized ${TOKEN}` } : { ok: true, message_id: null }));
  const info: string[] = [];
  const error: string[] = [];
  const ok = await applyMenuPlan(f.api, menuPlan([], URL_), TOKEN, { info: (s) => info.push(s), error: (s) => error.push(s) });
  expect([ok, error, info]).toEqual([false, ["kpi menu: default fail: Unauthorized ***"], ["kpi menu: default fail, uz chats 0/0, ru chats 0/0"]]);
});

it("miniAppUrl: только разбираемый https с хостом, без ? и #, хвостовой слэш", () => {
  const cases: [string | undefined, string | null][] = [
    [undefined, null], ["", null], ["http://x.test/kpi-app/", null], ["x.test/kpi-app", null], ["javascript:alert(1)", null],
    ["https://x.test/kpi-app", "https://x.test/kpi-app/"], [" https://x.test/kpi-app/ ", "https://x.test/kpi-app/"],
    // хеш-маршрут экрана дописывается к адресу: запрос или фрагмент в нём ломают ссылку, Telegram отвергнет кнопку
    ["https://?", null], ["https://x.test/app?v=1", null], ["https://x.test/app#/x", null],
    ["https://x.test/app?", null], ["https://x.test/app#", null],
    ["https://", null], ["https://x.test/a b", null], ["https://x.test:99999/", null],
    // наружу — разобранный адрес
    ["https://X.test/kpi-app", "https://x.test/kpi-app/"], ["https://x.test", "https://x.test/"],
  ];
  const saved = process.env.KPI_MINIAPP_URL;
  try {
    for (const [v, want] of cases) {
      if (v === undefined) delete process.env.KPI_MINIAPP_URL; else process.env.KPI_MINIAPP_URL = v;
      expect(miniAppUrl()).toBe(want);
    }
  } finally { if (saved === undefined) delete process.env.KPI_MINIAPP_URL; else process.env.KPI_MINIAPP_URL = saved; }
});

it("appRoute по видам уведомлений", () => {
  expect(appRoute("review_submitted", { period: "2026-10-01" })).toBe("/review/2026-10");
  expect(appRoute("review_changed", { period: "2026-10-01" })).toBe("/review/2026-10");
  expect(appRoute("violation_recorded", { period: "2026-10-01" })).toBe("/violations/2026-10");
  expect(appRoute("dispute_resolved", { period: "2026-10-01", subject_type: "violation" })).toBe("/violations/2026-10");
  expect(appRoute("dispute_resolved", { period: "2026-10-01", subject_type: "review" })).toBe("/review/2026-10");
  expect(appRoute("raise_approved", { quarter_start: "2026-10-01" })).toBe("/history");
  expect([appRoute("remind_evaluate", { period: "2026-10-01" }), appRoute("review_submitted", { period: "2026-10" })]).toEqual([null, null]);
});
