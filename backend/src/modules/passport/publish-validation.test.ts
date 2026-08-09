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
  test("observation checklist without questions array blocks", () => {
    const errs = validateModuleForPublish({ title_ru: "К", title_uz: "K" },
      [{ ...okTopic, observation_checklist: { items: [{ ru: "нож", uz: "pichoq" }] } }]);
    expect(errs.some((e) => e.includes("questions"))).toBe(true);
  });
  test("topic-level uz field missing blocks", () => {
    const errs = validateModuleForPublish({ title_ru: "К", title_uz: "K" },
      [{ ...okTopic, key_point_uz: "   " }]);
    expect(errs.some((e) => e.includes("key_point"))).toBe(true);
  });
  test("module without topics blocks", () => {
    expect(validateModuleForPublish({ title_ru: "К", title_uz: "K" }, []).length).toBeGreaterThan(0);
  });

  // The sign-off endpoint refuses these two types with 409 (controller.ts:1219,
  // :1233) and a published module can never be unpublished, so publishing one
  // would strand the trainee at level 2 forever. Assert on the exact type string
  // AND the topic number: a looser match would also be satisfied by the
  // pre-existing quiz_test_id error and pass for the wrong reason.
  test("dual verification type cannot be published", () => {
    const errs = validateModuleForPublish({ title_ru: "К", title_uz: "K" },
      [{ ...okTopic, verification_type: "dual" }]);
    expect(errs.some((e) => e.startsWith("topic 1:") && e.includes('"dual"'))).toBe(true);
  });
  test("quiz_observation_photo verification type cannot be published", () => {
    const errs = validateModuleForPublish({ title_ru: "К", title_uz: "K" },
      [{ ...okTopic, verification_type: "quiz_observation_photo" }]);
    expect(errs.some((e) => e.startsWith("topic 1:") && e.includes('"quiz_observation_photo"'))).toBe(true);
  });
  test("unsignable type is reported against the right topic index and does not block its siblings", () => {
    const errs = validateModuleForPublish({ title_ru: "К", title_uz: "K" },
      [okTopic, { ...okTopic, verification_type: "dual" }, okTopic]);
    expect(errs).toEqual([
      errs.find((e) => e.startsWith("topic 2:")) as string,
    ]);
    expect(errs[0]).toContain('"dual"');
  });
  test("unsignable type is refused even when its checklist is malformed (single, clear error)", () => {
    const errs = validateModuleForPublish({ title_ru: "К", title_uz: "K" },
      [{ ...okTopic, verification_type: "quiz_observation_photo", observation_checklist: null }]);
    expect(errs.length).toBe(1);
    expect(errs[0]).toContain('"quiz_observation_photo"');
    expect(errs[0]).not.toContain("checklist items");
  });
});
