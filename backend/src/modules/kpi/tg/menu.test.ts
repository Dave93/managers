import { expect, it } from "bun:test";
import { menuPlan } from "./menu";
import { appRoute, miniAppUrl } from "./miniapp-url";

it("menuPlan: по умолчанию русская, узбекским чатам своя, без повторов", () => {
  expect(menuPlan([{ telegram_id: 3, lang: "uz" }, { telegram_id: 1, lang: "ru" }, { telegram_id: 2, lang: "uz" }, { telegram_id: 2, lang: "uz" }]))
    .toEqual([{ chatId: null, text: "Мой KPI" }, { chatId: 2, text: "Mening KPI" }, { chatId: 3, text: "Mening KPI" }]);
});

it("miniAppUrl: только https, хвостовой слэш", () => {
  const cases: [string | undefined, string | null][] = [
    [undefined, null], ["", null], ["http://x.test/kpi-app/", null], ["x.test/kpi-app", null], ["javascript:alert(1)", null],
    ["https://x.test/kpi-app", "https://x.test/kpi-app/"], [" https://x.test/kpi-app/ ", "https://x.test/kpi-app/"],
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
