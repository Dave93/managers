import { KpiError } from "../kpi/errors";
import { WorklyError } from "./client";

// Короткий код сбоя для лога и failedReason. Только WorklyError.code и KpiError.code;
// всё прочее (в том числе ошибка базы с параметрами запроса) — общий job_failed.
// Живёт отдельно от nightly.ts: им пользуются и ночной прогон, и опрос действий (activity.ts).
export function jobFailureCode(e: unknown): string {
  if (e instanceof WorklyError || e instanceof KpiError) return e.code;
  return "job_failed";
}
