import { hasQuiz, hasObservation, needsPhoto, type VerificationType } from "./state";

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

// Verification types the stage-1 sign-off endpoint REFUSES with 409
// (controller.ts:1219 for `dual`, controller.ts:1233 for the needsPhoto() case).
// Kept in exactly that shape so the two sets stay obviously in sync if a third
// unsignable type appears: add it here and there in the same commit.
const isUnsignable = (vt: VerificationType) => vt === "dual" || needsPhoto(vt);

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
      // Publishing an unsignable topic creates an UNRECOVERABLE state: the
      // trainee passes the quiz, reaches level 2, and the mentor then hits a
      // permanent 409 on sign-off -- while a published module is frozen against
      // every write (controller.ts:98-101), has no unpublish route, no `active`
      // column, and no DELETE on passport_program_modules. `new-version` does
      // not help either: it mints fresh topic ids and ADDS a second program
      // link, leaving the broken module published and linked. Only hand-written
      // SQL could clean it up -- so the gate has to be here, at publish time.
      if (isUnsignable(vt)) {
        errors.push(
          `topic ${i + 1}: verification_type "${vt}" cannot be published yet -- mentor sign-off is not available for it (no photo upload / no second-signature mechanism); use "quiz", "observation" or "quiz_observation"`
        );
        return; // checklist shape is moot while the type itself is refused
      }
      const cl = t.observation_checklist as { items?: unknown[]; questions?: unknown[] } | null;
      if (!cl || !Array.isArray(cl.items) || cl.items.length === 0)
        errors.push(`topic ${i + 1}: observation_checklist items required`);
      // questions may be empty, but the key MUST exist as an array: observationComplete()
      // in state.ts dereferences checklist.questions.length unconditionally.
      if (!cl || !Array.isArray(cl.questions))
        errors.push(`topic ${i + 1}: observation_checklist questions must be an array`);
    }
  });
  return errors;
}
