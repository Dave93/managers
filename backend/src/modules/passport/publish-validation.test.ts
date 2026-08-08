import { describe, expect, test } from "bun:test";
import { validateModuleForPublish } from "./publish-validation";

const okTopic = {
  title_ru: "ФИФО", title_uz: "FIFO", step_ru: "ш", step_uz: "s",
  key_point_ru: "к", key_point_uz: "k", reason_ru: "п", reason_uz: "p",
  verification_type: "quiz_observation", quiz_test_id: "11111111-1111-1111-1111-111111111111",
  observation_checklist: { items: [{ ru: "нож", uz: "pichoq" }], questions: [{ ru: "зачем?", uz: "nega?" }] },
};

describe("publish validation", () => {
  test("ok module passes", () => {
    expect(validateModuleForPublish({ title_ru: "Кухня", title_uz: "Oshxona" }, [okTopic])).toEqual([]);
  });
  test("missing uz title blocks", () => {
    const errs = validateModuleForPublish({ title_ru: "Кухня", title_uz: "" }, [okTopic]);
    expect(errs.length).toBeGreaterThan(0);
  });
  test("quiz type without quiz_test_id blocks", () => {
    const errs = validateModuleForPublish({ title_ru: "К", title_uz: "K" },
      [{ ...okTopic, quiz_test_id: null }]);
    expect(errs.some((e) => e.includes("quiz"))).toBe(true);
  });
  test("observation type without checklist blocks", () => {
    const errs = validateModuleForPublish({ title_ru: "К", title_uz: "K" },
      [{ ...okTopic, verification_type: "observation", observation_checklist: null }]);
    expect(errs.some((e) => e.includes("checklist"))).toBe(true);
  });
  test("module without topics blocks", () => {
    expect(validateModuleForPublish({ title_ru: "К", title_uz: "K" }, []).length).toBeGreaterThan(0);
  });
});
