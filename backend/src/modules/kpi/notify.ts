// Только запись в очередь; доставку делает воркер (план 4).
import { kpi_notifications } from "backend/drizzle/schema";
import type { DbLike } from "./access";

export type NotifyInput = {
  recipient_kind: "employee" | "user";
  employee_id?: string;
  user_id?: string;
  kind: string;
  payload: Record<string, unknown>;
  dedupe_key: string;
};

// Повтор с тем же dedupe_key молча игнорируется.
export async function enqueue(tx: DbLike, n: NotifyInput): Promise<void> {
  await tx
    .insert(kpi_notifications)
    .values({
      recipient_kind: n.recipient_kind,
      employee_id: n.employee_id ?? null,
      user_id: n.user_id ?? null,
      kind: n.kind,
      payload: n.payload,
      dedupe_key: n.dedupe_key,
    })
    .onConflictDoNothing({ target: kpi_notifications.dedupe_key });
}
