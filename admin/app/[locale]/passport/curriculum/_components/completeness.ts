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

export const VERIFICATION_LABELS: Record<PassportVerificationType, string> = {
  quiz: "Квиз",
  observation: "Наблюдение наставника",
  quiz_observation: "Квиз + наблюдение",
  quiz_observation_photo: "Квиз + наблюдение + фото",
  dual: "Двойная подпись",
};

export const UNSIGNABLE_WARNING =
  "На текущем этапе такую тему нельзя подписать: у наставника нет ни загрузки фото, ни второй подписи. Публикация модуля с такой темой будет отклонена. Выберите «Квиз», «Наблюдение» или «Квиз + наблюдение».";

/** The four bilingual pairs the publish gate checks, in form order. */
export const TOPIC_PAIRS = [
  { key: "title", ru: "title_ru", uz: "title_uz", label: "Название темы" },
  { key: "step", ru: "step_ru", uz: "step_uz", label: "Шаг — что делаем" },
  {
    key: "key_point",
    ru: "key_point_ru",
    uz: "key_point_uz",
    label: "Ключевой момент — как именно",
  },
  { key: "reason", ru: "reason_ru", uz: "reason_uz", label: "Почему так" },
] as const;

export type TopicPairKey = (typeof TOPIC_PAIRS)[number]["key"];

const filled = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export interface PairState {
  key: TopicPairKey;
  label: string;
  ru: boolean;
  uz: boolean;
  complete: boolean;
}

/** Per-pair fill state of a topic (works on a half-typed form value too). */
export function topicPairStates(topic: Record<string, any>): PairState[] {
  return TOPIC_PAIRS.map((p) => {
    const ru = filled(topic[p.ru]);
    const uz = filled(topic[p.uz]);
    return { key: p.key, label: p.label, ru, uz, complete: ru && uz };
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
export function topicBlockers(topic: Record<string, any>): string[] {
  const out: string[] = [];
  for (const p of topicPairStates(topic)) {
    if (p.complete) continue;
    const missing = !p.ru && !p.uz ? "RU и UZ" : !p.ru ? "RU" : "UZ";
    out.push(`${p.label}: не заполнено (${missing})`);
  }
  const vt = (topic.verification_type ??
    "quiz_observation") as PassportVerificationType;
  if (isUnsignable(vt)) {
    out.push(
      `Тип проверки «${VERIFICATION_LABELS[vt]}» пока нельзя опубликовать — наставник не сможет подписать тему`
    );
    // publish-validation.ts returns early here: the checklist shape is moot
    // while the type itself is refused. Mirror that, or the panel shows
    // blockers the server will never mention.
    return out;
  }
  if (hasQuiz(vt) && !topic.quiz_test_id)
    out.push("Не выбран тест для квиза");
  if (hasObservation(vt)) {
    const cl = topic.observation_checklist as {
      items?: unknown[];
      questions?: unknown[];
    } | null;
    if (!cl || !Array.isArray(cl.items) || cl.items.length === 0)
      out.push("Чек-лист наблюдения: нет ни одного пункта");
    if (!cl || !Array.isArray(cl.questions))
      out.push("Чек-лист наблюдения: нет блока контрольных вопросов");
  }
  return out;
}

export const topicIsComplete = (topic: Record<string, any>) =>
  topicBlockers(topic).length === 0;

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
  mod: Pick<PassportModule, "title_ru" | "title_uz"> | null | undefined,
  topics: PassportTopic[]
): ModuleReadiness {
  const list = publishTopics(topics);
  const modBlockers: string[] = [];
  if (mod && (!filled(mod.title_ru) || !filled(mod.title_uz)))
    modBlockers.push("Название модуля нужно на обоих языках (RU и UZ)");
  if (list.length === 0)
    modBlockers.push("В модуле нет ни одной активной темы");

  const perTopic: ModuleReadiness["topicBlockers"] = [];
  let incompleteTranslations = 0;
  list.forEach((t, i) => {
    if (topicMissingLangs(t).any) incompleteTranslations += 1;
    const reasons = topicBlockers(t);
    if (reasons.length) perTopic.push({ topic: t, index: i + 1, reasons });
  });

  return {
    ready: modBlockers.length === 0 && perTopic.length === 0,
    moduleBlockers: modBlockers,
    topicBlockers: perTopic,
    incompleteTranslations,
    total: list.length,
  };
}
