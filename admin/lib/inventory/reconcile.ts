import type { ReconCandidate } from "@backend/modules/inventory/reconcile/types";
import type { InterimReconLine } from "@backend/modules/inventory/book/types";

/** Выбор документа нужен всегда, когда есть кандидаты: и при needs_choice, и когда
 * загруженный документ пропал из iiko, а вместо него появились другие. */
export function canChooseDocument(d: { status: string; iiko_candidates: ReconCandidate[] | null }): boolean {
  return (d.iiko_candidates?.length ?? 0) > 0;
}

/** Промежуточная сверка: A ≠ книжного iiko (без снимка iiko — не расхождение). */
export const interimMismatch = (l: InterimReconLine) => l.diff_qty !== null && Number(l.diff_qty) !== 0;

/** Строки промежуточной сверки по группам, как на экране и в Excel; only — «Только A ≠ iiko». */
export function interimGroups(lines: InterimReconLine[], only: boolean): [string, InterimReconLine[]][] {
  const by = new Map<string, InterimReconLine[]>();
  for (const l of lines) {
    if (only && !interimMismatch(l)) continue;
    by.set(l.group_name, [...(by.get(l.group_name) ?? []), l]);
  }
  return [...by.entries()];
}
