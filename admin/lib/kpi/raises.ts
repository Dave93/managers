// Решение по квартальному повышению: когда нужен комментарий, что мешает сохранить, тело запроса.
import type { DecideBody, RaiseRow } from "@admin/lib/kpi-api";
import { parseAmount } from "@admin/lib/kpi/format";
import { ruT, type KpiT } from "@admin/lib/kpi/i18n";
import { commentOk } from "@admin/lib/kpi/review-form";

export type DecisionInput = { status: "approved" | "rejected"; amount: string; comment: string };
export type DecisionIssue = "stale" | "periods_open" | "bad_amount" | "comment_required";

/** Почему нужен комментарий (правило плана 1, задача 9), либо null. */
export function commentReason(
  row: Pick<RaiseRow, "status" | "suggested_amount">,
  input: Pick<DecisionInput, "status" | "amount">,
  t: KpiT = ruT
): string | null {
  if (row.status === "approved" || row.status === "rejected") return t("lib.raises.reasonRepeat");
  if (row.status === "insufficient") return t("lib.raises.reasonInsufficient");
  if (input.status === "rejected" && row.suggested_amount > 0) return t("lib.raises.reasonDeclined");
  if (input.status === "approved" && parseAmount(input.amount) !== row.suggested_amount) return t("lib.raises.reasonDiffers");
  return null;
}

/**
 * Что мешает сохранить решение, в порядке проверок сервера. `stale` — только у нерешённой строки
 * (у решённой это предупреждение, сервер её принимает). Комментарий считается по буквам и цифрам, как на сервере.
 */
export function decisionIssues(
  row: Pick<RaiseRow, "status" | "suggested_amount" | "periods_closed" | "stale">,
  input: DecisionInput,
  cap: number
): DecisionIssue[] {
  const out: DecisionIssue[] = [];
  if (row.stale && (row.status === "proposed" || row.status === "insufficient")) out.push("stale");
  if (!row.periods_closed) out.push("periods_open");
  if (input.status === "approved") {
    const n = parseAmount(input.amount);
    if (n === null || n > cap) out.push("bad_amount");
  }
  if (commentReason(row, input) !== null && !commentOk(input.comment, 1)) out.push("comment_required");
  return out;
}

export function decisionBody(input: DecisionInput): DecideBody {
  const body: DecideBody = { status: input.status };
  if (input.status === "approved") {
    const n = parseAmount(input.amount);
    if (n !== null) body.amount = n;
  }
  const comment = input.comment.trim();
  if (comment) body.comment = comment;
  return body;
}
