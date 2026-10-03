export type VerificationType = "quiz" | "observation" | "quiz_observation" | "quiz_observation_photo" | "dual";

export const hasQuiz = (vt: VerificationType) => vt !== "observation";
export const hasObservation = (vt: VerificationType) => vt !== "quiz";
export const needsPhoto = (vt: VerificationType) => vt === "quiz_observation_photo";

export const levelAfterMaterialOpened = (current: number) => Math.max(current, 1);

export const levelAfterQuizPassed = (current: number, vt: VerificationType) =>
  hasObservation(vt) ? Math.max(current, 2) : Math.max(current, 3);

export const canObserve = (current: number, vt: VerificationType) =>
  hasObservation(vt) && current >= (hasQuiz(vt) ? 2 : 1);

export const levelAfterObserved = (current: number) => Math.max(current, 3);
export const levelAfterRecheckFailed = () => 2;

export const observationComplete = (
  checklist: { items: unknown[]; questions: unknown[] },
  answers: { items: boolean[]; questions: boolean[] }
): boolean =>
  answers.items.length === checklist.items.length &&
  answers.questions.length === checklist.questions.length &&
  answers.items.every(Boolean) &&
  answers.questions.every(Boolean);
