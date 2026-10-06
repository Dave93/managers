import type { ReconCandidate } from "@backend/modules/inventory/reconcile/types";

/** Выбор документа нужен всегда, когда есть кандидаты: и при needs_choice, и когда
 * загруженный документ пропал из iiko, а вместо него появились другие. */
export function canChooseDocument(d: { status: string; iiko_candidates: ReconCandidate[] | null }): boolean {
  return (d.iiko_candidates?.length ?? 0) > 0;
}
