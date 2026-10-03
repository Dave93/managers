// POST /passport/modules/:id/publish answers 422 with `{errors: string[]}` and
// those strings are the single most useful thing on this screen — they name
// exactly what stops the module going live. The backend writes them in English
// with a positional topic label ("topic 3: step required in both languages")
// because publish-validation.ts is a pure function with no i18n and no topic
// titles in scope. This module turns them into Russian and puts the topic's
// real name in, WITHOUT ever swallowing one it does not recognise.
//
// Two rules that matter:
//  1. `topic N` is 1-based into ACTIVE topics ORDERED BY sort (the list the
//     publish route builds, controller.ts:607-618) — see publishTopics().
//     Indexing into the raw listTopics() result mislabels every error the
//     moment a module has one inactive topic.
//  2. Anything unmatched is passed through verbatim. The backend may grow new
//     reasons; showing an English sentence is recoverable, dropping a blocker
//     silently is not.

import type { PassportTopic, PassportVerificationType } from "@admin/lib/passport-api";
import { VERIFICATION_LABELS, publishTopics } from "./completeness";

export interface PublishIssue {
  /** 1-based position in the published topic list, or null for module-level. */
  topicIndex: number | null;
  topicId: string | null;
  topicTitle: string | null;
  text: string;
  /** true when we recognised the reason and translated it. */
  translated: boolean;
}

const PAIR_LABELS: Record<string, string> = {
  title: "название",
  step: "шаг",
  key_point: "ключевой момент",
  reason: "объяснение «почему так»",
};

function translateReason(reason: string): string | null {
  let m = reason.match(/^(title|step|key_point|reason) required in both languages$/);
  if (m) return `не заполнено на обоих языках — ${PAIR_LABELS[m[1]]} (нужны RU и UZ)`;

  if (reason === "quiz_test_id required for quiz type")
    return "не выбран тест для квиза";

  m = reason.match(/^verification_type "([a-z_]+)" cannot be published yet/);
  if (m) {
    const vt = m[1] as PassportVerificationType;
    const label = VERIFICATION_LABELS[vt] ?? vt;
    return `тип проверки «${label}» пока нельзя опубликовать — наставник не сможет её подписать (нет ни загрузки фото, ни второй подписи). Выберите «Квиз», «Наблюдение» или «Квиз + наблюдение»`;
  }

  if (reason === "observation_checklist items required")
    return "чек-лист наблюдения пуст — добавьте хотя бы один пункт";

  if (reason === "observation_checklist questions must be an array")
    return "в чек-листе наблюдения нет блока контрольных вопросов";

  return null;
}

function translateModuleReason(reason: string): string | null {
  if (reason === "title_ru/title_uz required")
    return "название модуля нужно заполнить на обоих языках (RU и UZ)";
  if (reason === "no topics")
    return "в модуле нет ни одной активной темы";
  return null;
}

/**
 * @param raw    the `errors` array from publishErrors(error)
 * @param topics the FULL topic list of the module (listTopics result); it is
 *               filtered/sorted here the same way the backend does.
 */
export function translatePublishErrors(
  raw: string[],
  topics: PassportTopic[]
): PublishIssue[] {
  const ordered = publishTopics(topics);

  return raw.map((line): PublishIssue => {
    const topicMatch = line.match(/^topic (\d+): ([\s\S]+)$/);
    if (topicMatch) {
      const index = Number(topicMatch[1]);
      const topic = ordered[index - 1];
      const title = topic?.title_ru?.trim() || null;
      const translated = translateReason(topicMatch[2]);
      return {
        topicIndex: index,
        topicId: topic?.id ?? null,
        topicTitle: title,
        text: translated ?? topicMatch[2],
        translated: translated !== null,
      };
    }

    const moduleMatch = line.match(/^module: ([\s\S]+)$/);
    if (moduleMatch) {
      const translated = translateModuleReason(moduleMatch[1]);
      return {
        topicIndex: null,
        topicId: null,
        topicTitle: null,
        text: translated ?? moduleMatch[1],
        translated: translated !== null,
      };
    }

    // Unknown shape entirely — show it as-is rather than lose it.
    return {
      topicIndex: null,
      topicId: null,
      topicTitle: null,
      text: line,
      translated: false,
    };
  });
}

/** «Тема 3 «Раскатка теста»» / «Модуль» — the label in front of the reason. */
export function issueLabel(issue: PublishIssue): string {
  if (issue.topicIndex === null) return "Модуль";
  return issue.topicTitle
    ? `Тема ${issue.topicIndex} «${issue.topicTitle}»`
    : `Тема ${issue.topicIndex}`;
}
