// Client mirror of backend/src/modules/passport/publish-validation.ts
// (validateModuleForPublish) plus the three predicates it imports from
// state.ts. It exists so the tree can show WHAT WILL BLOCK PUBLICATION before
// anyone presses «Опубликовать» — the whole point of the screen — instead of
// only after a 422 round-trip.
//
// This is a MIRROR, not a replacement: the backend gate stays authoritative.
// If the two ever disagree the 422 list wins on screen (publish-errors.ts
// renders whatever the server actually said, including reasons this file does
// not know about). Keep the rules below in sync with publish-validation.ts —
// they were transcribed from it line by line:
//   - both languages required for title / step / key_point / reason
//   - module needs title_ru + title_uz and at least one ACTIVE topic
//   - hasQuiz(vt)        -> quiz_test_id required
//   - hasObservation(vt) -> checklist.items non-empty AND checklist.questions
//                           an array
//   - dual / quiz_observation_photo are refused outright (unsignable)
//
// ONE function per question, consumed by both the tree badge and the readiness
// panel — two predicates would drift and the tree would start lying.

import type {
  PassportModule,
  PassportTopic,
  PassportVerificationType,
} from "@admin/lib/passport-api";

// backend/src/modules/passport/state.ts:3-5, verbatim.
export const hasQuiz = (vt: PassportVerificationType) => vt !== "observation";
export const hasObservation = (vt: PassportVerificationType) => vt !== "quiz";
export const needsPhoto = (vt: PassportVerificationType) =>
  vt === "quiz_observation_photo";

// publish-validation.ts:20 — the sign-off endpoint 409s on these, so the
// publish gate refuses them. The UI must warn at the moment of choosing the
// type, not after a failed publish.
export const isUnsignable = (vt: PassportVerificationType) =>
  vt === "dual" || needsPhoto(vt);

/**
 * Translator bound to the `passportUi.curriculum` namespace. These helpers are
 * plain functions (no hooks), so callers pass their own `t`.
 */
export type Tr = (key: string, values?: Record<string, string | number>) => string;

export const verificationLabel = (t: Tr, vt: string) =>
  t(`verification.${vt}`);

/** The four bilingual pairs the publish gate checks, in form order. */
export const TOPIC_PAIRS = [
  { key: "title", ru: "title_ru", uz: "title_uz", labelKey: "pairs.title" },
  { key: "step", ru: "step_ru", uz: "step_uz", labelKey: "pairs.step" },
  {
    key: "key_point",
    ru: "key_point_ru",
    uz: "key_point_uz",
    labelKey: "pairs.keyPoint",
  },
  { key: "reason", ru: "reason_ru", uz: "reason_uz", labelKey: "pairs.reason" },
] as const;

export type TopicPairKey = (typeof TOPIC_PAIRS)[number]["key"];

const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export interface PairState {
  key: TopicPairKey;
  labelKey: string;
  ru: boolean;
  uz: boolean;
  complete: boolean;
}

/** Per-pair fill state of a topic (works on a half-typed form value too). */
export function topicPairStates(topic: Record<string, any>): PairState[] {
  return TOPIC_PAIRS.map((p) => {
    const ru = filled(topic[p.ru]);
    const uz = filled(topic[p.uz]);
    return { key: p.key, labelKey: p.labelKey, ru, uz, complete: ru && uz };
  });
}

/**
 * Which language column of a topic is missing something. Drives the RU/UZ pips
 * in the tree: a pair with only one side filled is the state that blocks
 * publication, and it has to be visible without opening the editor.
 */
export function topicMissingLangs(topic: Record<string, any>): {
  ru: number;
  uz: number;
  any: boolean;
} {
  let ru = 0;
  let uz = 0;
  for (const p of topicPairStates(topic)) {
    if (!p.ru) ru += 1;
    if (!p.uz) uz += 1;
  }
  return { ru, uz, any: ru > 0 || uz > 0 };
}

/** Every reason this ONE topic would block its module's publication. */
export function topicBlockers(t: Tr, topic: Record<string, any>): string[] {
  const out: string[] = [];
  for (const p of topicPairStates(topic)) {
    if (p.complete) continue;
    const missing =
      !p.ru && !p.uz ? t("blockers.missingBoth") : !p.ru ? "RU" : "UZ";
    out.push(t("blockers.pairMissing", { label: t(p.labelKey), missing }));
  }
  const vt = (topic.verification_type ??
    "quiz_observation") as PassportVerificationType;
  if (isUnsignable(vt)) {
    out.push(t("blockers.unsignable", { type: verificationLabel(t, vt) }));
    // publish-validation.ts returns early here: the checklist shape is moot
    // while the type itself is refused. Mirror that, or the panel shows
    // blockers the server will never mention.
    return out;
  }
  if (hasQuiz(vt) && !topic.quiz_test_id)
    out.push(t("blockers.noQuiz"));
  if (hasObservation(vt)) {
    const cl = topic.observation_checklist as {
      items?: unknown[];
      questions?: unknown[];
    } | null;
    if (!cl || !Array.isArray(cl.items) || cl.items.length === 0)
      out.push(t("blockers.noChecklistItems"));
    if (!cl || !Array.isArray(cl.questions))
      out.push(t("blockers.noChecklistQuestions"));
  }
  return out;
}

export const topicIsComplete = (t: Tr, topic: Record<string, any>) =>
  topicBlockers(t, topic).length === 0;

/**
 * The exact topic list the backend feeds validateModuleForPublish:
 * `active = true`, ordered by `sort` (controller.ts:607-618). The `topic N`
 * index inside a 422 message is 1-based INTO THIS LIST — resolving it against
 * the raw list would mislabel every error as soon as a module has one inactive
 * topic, and a mislabeled blocker sends the editor to the wrong topic.
 */
export function publishTopics(topics: PassportTopic[]): PassportTopic[] {
  return topics
    .filter((t) => t.active)
    .slice()
    .sort((a, b) => a.sort - b.sort);
}

export interface ModuleReadiness {
  ready: boolean;
  /** Module-level blockers (title pair, no topics). */
  moduleBlockers: string[];
  /** Per-topic blockers, keyed by topic id, only for topics that have any. */
  topicBlockers: Array<{ topic: PassportTopic; index: number; reasons: string[] }>;
  /** Topics with at least one half-filled bilingual pair. */
  incompleteTranslations: number;
  total: number;
}

/** Whole-module readiness, mirroring validateModuleForPublish's order. */
export function moduleReadiness(
  t: Tr,
  mod: Pick<PassportModule, "title_ru" | "title_uz"> | null | undefined,
  topics: PassportTopic[]
): ModuleReadiness {
  const list = publishTopics(topics);
  const modBlockers: string[] = [];
  if (mod && (!filled(mod.title_ru) || !filled(mod.title_uz)))
    modBlockers.push(t("blockers.moduleTitle"));
  if (list.length === 0)
    modBlockers.push(t("blockers.noActiveTopics"));

  const perTopic: ModuleReadiness["topicBlockers"] = [];
  let incompleteTranslations = 0;
  list.forEach((topic, i) => {
    if (topicMissingLangs(topic).any) incompleteTranslations += 1;
    const reasons = topicBlockers(t, topic);
    if (reasons.length) perTopic.push({ topic, index: i + 1, reasons });
  });

  return {
    ready: modBlockers.length === 0 && perTopic.length === 0,
    moduleBlockers: modBlockers,
    topicBlockers: perTopic,
    incompleteTranslations,
    total: list.length,
  };
}
