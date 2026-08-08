import { hasQuiz, hasObservation, type VerificationType } from "./state";

type TopicInput = {
  title_ru: string; title_uz: string; step_ru: string; step_uz: string;
  key_point_ru: string; key_point_uz: string; reason_ru: string; reason_uz: string;
  verification_type: string; quiz_test_id: string | null; observation_checklist: unknown;
};

const PAIRS: Array<[keyof TopicInput, keyof TopicInput, string]> = [
  ["title_ru", "title_uz", "title"],
  ["step_ru", "step_uz", "step"],
  ["key_point_ru", "key_point_uz", "key_point"],
  ["reason_ru", "reason_uz", "reason"],
];

export function validateModuleForPublish(
  mod: { title_ru: string; title_uz: string },
  topics: TopicInput[]
): string[] {
  const errors: string[] = [];
  if (!mod.title_ru.trim() || !mod.title_uz.trim()) errors.push("module: title_ru/title_uz required");
  if (topics.length === 0) errors.push("module: no topics");
  topics.forEach((t, i) => {
    for (const [ru, uz, name] of PAIRS) {
      if (!String(t[ru] ?? "").trim() || !String(t[uz] ?? "").trim())
        errors.push(`topic ${i + 1}: ${name} required in both languages`);
    }
    const vt = t.verification_type as VerificationType;
    if (hasQuiz(vt) && !t.quiz_test_id) errors.push(`topic ${i + 1}: quiz_test_id required for quiz type`);
    if (hasObservation(vt)) {
      const cl = t.observation_checklist as { items?: unknown[]; questions?: unknown[] } | null;
      if (!cl || !Array.isArray(cl.items) || cl.items.length === 0)
        errors.push(`topic ${i + 1}: observation_checklist items required`);
    }
  });
  return errors;
}
