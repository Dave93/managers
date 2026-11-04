// Споры оценщика как данные (без DOM): порядок строк, чипы, проверки и тело разбора.
import type { EvDispute, EvDisputeDetail, EvDisputes } from "@backend/modules/kpi/tg-app/ev-types";
import { dayMonth } from "../format";
import type { Lang } from "../i18n";
import { monthName, tIn } from "../i18n";
import { reasonCount } from "../util";
import { type Draft, type FormIssue, reviewIssues, toItemInputs } from "./ev-score";

export interface EvDisputeRowVM { id: string; who: string; kind: string; when: string; reason: string; chip: { text: string; tone: "ok" | "wait" | "warn" | "muted" }; canResolve: boolean; hash: string }
export type ResolveDecision = "accepted" | "rejected";
type Args = { decision: ResolveDecision; comment: string; draft: Draft };

// Свои открытые сверху (свежие выше), чужие открытые, разобранные — по давности разбора.
const rank = (d: EvDispute): number => (d.status === "open" ? (d.can_resolve ? 0 : 1) : 2);

export function evDisputesView(d: EvDisputes, l: Lang): { rows: EvDisputeRowVM[]; empty: boolean } {
  const sorted = [...d.items].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const ka = a.status === "open" ? a.created_at : (a.resolved_at ?? a.created_at);
    const kb = b.status === "open" ? b.created_at : (b.resolved_at ?? b.created_at);
    return ka < kb ? 1 : ka > kb ? -1 : 0;
  });
  const rows = sorted.map((x): EvDisputeRowVM => ({
    id: x.id,
    who: [x.employee_name, x.terminal_name].filter((p): p is string => !!p).join(" · "),
    kind: tIn(l, x.subject_type === "review" ? "ev_dsp_review" : "ev_dsp_violation", { month: monthName(x.period, "nom", l) }),
    when: dayMonth(x.created_at, l),
    reason: x.reason,
    chip: x.status === "accepted" ? { text: tIn(l, "ev_dsp_chip_accepted"), tone: "ok" } : x.status === "rejected" ? { text: tIn(l, "ev_dsp_chip_rejected"), tone: "muted" }
      : x.can_resolve ? { text: tIn(l, "ev_dsp_chip_wait"), tone: "wait" } : { text: tIn(l, "ev_dsp_chip_other"), tone: "muted" },
    canResolve: x.can_resolve,
    hash: `#/ev/dispute/${x.id}`,
  }));
  return { rows, empty: rows.length === 0 };
}

const byScores = (a: Args, d: EvDisputeDetail): boolean => a.decision === "accepted" && d.dispute.subject_type === "review" && d.form !== null;

export function resolveIssues(a: Args, d: EvDisputeDetail): FormIssue[] {
  if (byScores(a, d)) return reviewIssues((d.form as NonNullable<typeof d.form>).items, a.draft, "change", a.comment, d.comment_min);
  return reasonCount(a.comment) < d.comment_min ? [{ code: "comment_required" }] : [];
}

export function resolveBody(a: Args, d: EvDisputeDetail): { decision: ResolveDecision; comment: string; items?: { item_id: string; score: number | null; note: string | null }[] } {
  const base = { decision: a.decision, comment: a.comment.trim() };
  return byScores(a, d) ? { ...base, items: toItemInputs((d.form as NonNullable<typeof d.form>).items, a.draft) } : base;
}
