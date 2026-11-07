// Форма оценки как данные (без DOM): шапка, баннер, группы пунктов. Баллы и черновик — view/ev-score.ts.
import type { EvFormItem, EvFormViolation, EvReviewForm } from "@backend/modules/kpi/tg-app/ev-types";
import { dayMonth } from "../format";
import type { Key, Lang } from "../i18n";
import { monthName, tIn } from "../i18n";
import { capFirst } from "../util";

export interface EvItemVM { id: string; title: string; hint: string | null; sourceLabel: string | null; suggestionText: string | null; autoText: string | null; violationLine: string | null; violationComments: string[] }
export interface EvReviewVM {
  title: string; sub: string; mode: "edit" | "readonly";
  banner: { key: Key; vars?: Record<string, string | number> } | null;
  submitAllowed: boolean;
  groups: { key: "base" | "extra"; title: string; items: EvItemVM[] }[];
  otherViolations: string[];
}

const violationText = (v: EvFormViolation, l: Lang): string => `${dayMonth(v.occurred_at, l)}: ${v.comment}`;

function itemVM(i: EvFormItem, l: Lang): EvItemVM {
  return {
    id: i.item_id,
    title: l === "uz" && i.title_uz.trim() !== "" ? i.title_uz : i.title_ru,
    hint: i.hint_ru,
    sourceLabel: i.source === "manual" ? null : tIn(l, i.source === "attendance" ? "src_attendance" : "src_branch"),
    // Посещаемость считает система: вместо «Предложение» одна строка «Считает система» с баллом или «данных нет».
    suggestionText: i.source !== "attendance" && i.suggestion ? tIn(l, "ev_suggest", { score: i.suggestion.score, basis: i.suggestion.basis }) : null,
    autoText:
      i.source !== "attendance"
        ? null
        : i.score !== null
          ? tIn(l, "ev_att_auto", { score: i.score, basis: i.suggestion?.basis ?? "Workly" })
          : tIn(l, "ev_att_none"),
    violationLine: i.violations.length ? tIn(l, "ev_viol_line", { n: i.violations.length, hint: i.violation_hint ?? "—" }) : null,
    violationComments: i.violations.map((v) => violationText(v, l)),
  };
}

export function evReviewView(f: EvReviewForm, l: Lang, nowMs: number): EvReviewVM {
  const mode = f.can_edit ? "edit" : "readonly";
  const opened = nowMs >= Date.parse(f.submit_opens_at);
  let banner: EvReviewVM["banner"] = null;
  if (f.period_status === "closed") banner = { key: "ev_closed" };
  else if (f.review?.status === "submitted" && f.review.submitted_at) banner = { key: "ev_readonly_submitted", vars: { date: dayMonth(f.review.submitted_at, l) } };
  else if (f.open_dispute) banner = { key: "ev_readonly_dispute" };
  else if (!f.can_edit) banner = { key: "ev_readonly_scope" };
  else if (!opened) banner = { key: "ev_form_opens", vars: { date: dayMonth(f.submit_opens_at, l) } };

  const groups = (["base", "extra"] as const)
    .map((key) => ({ key, title: tIn(l, key === "base" ? "grp_base" : "grp_extra"), items: f.items.filter((i) => i.group_key === key).map((i) => itemVM(i, l)) }))
    .filter((g) => g.items.length > 0);

  return {
    title: `${f.employee.last_name} ${f.employee.first_name}`.trim(),
    sub: [f.employee.terminal_name, f.card_title, capFirst(monthName(f.period, "nom", l))].filter((x): x is string => !!x).join(" · "),
    mode,
    banner,
    submitAllowed: mode === "edit" && opened,
    groups,
    otherViolations: f.other_violations.map((v) => violationText(v, l)),
  };
}
