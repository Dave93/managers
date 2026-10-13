import type {
  InventoryCountDetail,
  InventoryEntry,
  InventoryLine,
  InventorySyncOp,
  InventorySyncResult,
} from "@backend/modules/inventory/types";
import { sumQty } from "./qty";

// pending — ещё не отправлено; confirmed — сервер принял, но успешного GET
// после этого ещё не было (держим на экране, иначе запись «пропадёт» при
// упавшем перезапросе); rejected — сервер не принял (видна, но не в итоге).
export type QueuedOp = {
  op: InventorySyncOp;
  state: "pending" | "confirmed" | "rejected";
  reason?: string;
  confirmedAt?: number;
};

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const queueKey = (countId: string) => `inventory:queue:${countId}`;
const detailKey = (countId: string) => `inventory:detail:${countId}`;

export function loadQueue(kv: KV, countId: string): QueuedOp[] {
  try {
    const raw = kv.getItem(queueKey(countId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveQueue(kv: KV, countId: string, q: QueuedOp[]): void {
  try {
    if (q.length) kv.setItem(queueKey(countId), JSON.stringify(q));
    else kv.removeItem(queueKey(countId));
  } catch {
    // Переполнение или запрет хранилища: очередь остаётся в памяти вкладки.
  }
}

// Операции создаются ДО setState: React в StrictMode вызывает функцию
// обновления дважды, и uuid внутри неё дал бы две разные копии записей.
export function buildAddOps(lineId: string, values: number[], nowIso: string, newId: () => string): QueuedOp[] {
  return values.map((qty) => ({
    state: "pending",
    op: { op: "add", id: newId(), line_id: lineId, qty, client_created_at: nowIso },
  }));
}

/** Чистая функция обновления очереди: добавляет заранее созданные операции. */
export function appendOps(ops: QueuedOp[]): (q: QueuedOp[]) => QueuedOp[] {
  return (q) => [...q, ...ops];
}

export function pendingOps(q: QueuedOp[]): InventorySyncOp[] {
  return q.filter((x) => x.state === "pending").map((x) => x.op);
}

export function applyResult(q: QueuedOp[], r: InventorySyncResult, now: number): QueuedOp[] {
  const applied = new Set(r.applied);
  const rejected = new Map(r.rejected.map((x) => [x.id, x.reason]));
  return q.map((item) => {
    if (item.state !== "pending") return item;
    if (rejected.has(item.op.id)) return { ...item, state: "rejected", reason: rejected.get(item.op.id) };
    if (applied.has(item.op.id)) return { ...item, state: "confirmed", confirmedAt: now };
    return item;
  });
}

/** Убирает подтверждённые операции, которые успешный GET, начатый после них, уже отражает. */
export function pruneConfirmed(q: QueuedOp[], fetchStartedAt: number): QueuedOp[] {
  return q.filter((item) => !(item.state === "confirmed" && (item.confirmedAt ?? 0) < fetchStartedAt));
}

/** Инвентаризацию вернули в черновик — отклонённые записи можно отправить снова (повтор id сервер игнорирует). */
export function retryRejected(q: QueuedOp[]): QueuedOp[] {
  return q.map((item) => (item.state === "rejected" ? { op: item.op, state: "pending" } : item));
}

export type SyncErrorAction = { kind: "reject"; reason: string } | { kind: "auth" } | { kind: "retry" };

// Что делать с пачкой, если sync вернул ошибку. Повторять имеет смысл только
// сеть и 5xx/429; 4xx не пройдут сколько ни повторяй и держали бы всю очередь.
export function classifySyncError(status: number): SyncErrorAction {
  if (status === 409) return { kind: "reject", reason: "not_draft" };
  if (status === 403) return { kind: "reject", reason: "forbidden" };
  if (status === 401) return { kind: "auth" };
  if (status === 429 || status === 0 || status >= 500) return { kind: "retry" };
  if (status >= 400) return { kind: "reject", reason: `http_${status}` };
  return { kind: "retry" };
}

export function rejectAll(q: QueuedOp[], ids: string[], reason: string): QueuedOp[] {
  const set = new Set(ids);
  return q.map((item) => (item.state === "pending" && set.has(item.op.id) ? { ...item, state: "rejected", reason } : item));
}

export type OverlayEntry = InventoryEntry & { pending?: boolean };
export type OverlayLine = Omit<InventoryLine, "entries"> & {
  entries: OverlayEntry[];
  /** Записи, которые сервер не принял: видны участнику, но не входят в итог. */
  rejected: OverlayEntry[];
};
export type OverlayDetail = Omit<InventoryCountDetail, "lines"> & { lines: OverlayLine[] };

export function isLineDone(line: OverlayLine): boolean {
  return line.skipped || line.entries.length > 0;
}

function toEntry(o: Extract<InventorySyncOp, { op: "add" }>, viewerId: string, youLabel: string, pending: boolean): OverlayEntry {
  return {
    id: o.id,
    line_id: o.line_id,
    qty: String(o.qty),
    created_by: viewerId,
    created_by_name: youLabel,
    client_created_at: o.client_created_at,
    pending,
  };
}

function serverEntryIds(detail: InventoryCountDetail): Set<string> {
  return new Set(detail.lines.flatMap((l) => l.entries.map((e) => e.id)));
}

/** Сколько отклонённых записей реально нет на сервере (для баннера). */
export function rejectedAddCount(detail: InventoryCountDetail, q: QueuedOp[]): number {
  const serverIds = serverEntryIds(detail);
  return q.filter((x) => x.state === "rejected" && x.op.op === "add" && !serverIds.has(x.op.id)).length;
}

// Ответ сервера + операции этого устройства, которых сервер ещё не отразил.
export function overlay(detail: InventoryCountDetail, q: QueuedOp[], youLabel: string): OverlayDetail {
  const live = q.filter((x) => x.state === "pending" || x.state === "confirmed");
  const deleted = new Set(live.filter((x) => x.op.op === "delete").map((x) => x.op.id));
  const serverIds = serverEntryIds(detail);
  const addsByLine = new Map<string, OverlayEntry[]>();
  const rejectedByLine = new Map<string, OverlayEntry[]>();
  for (const item of q) {
    const o = item.op;
    if (o.op !== "add" || serverIds.has(o.id)) continue;
    if (item.state === "rejected") {
      const list = rejectedByLine.get(o.line_id) ?? [];
      list.push(toEntry(o, detail.viewer_id, youLabel, false));
      rejectedByLine.set(o.line_id, list);
      continue;
    }
    if (deleted.has(o.id)) continue;
    const list = addsByLine.get(o.line_id) ?? [];
    list.push(toEntry(o, detail.viewer_id, youLabel, item.state === "pending"));
    addsByLine.set(o.line_id, list);
  }
  const lines: OverlayLine[] = detail.lines.map((l) => {
    const entries: OverlayEntry[] = [...l.entries.filter((e) => !deleted.has(e.id)), ...(addsByLine.get(l.id) ?? [])];
    return { ...l, entries, rejected: rejectedByLine.get(l.id) ?? [], total: sumQty(entries.map((e) => e.qty)) };
  });
  return { ...detail, lines, lines_done: lines.filter(isLineDone).length };
}

export function cacheDetail(kv: KV, detail: InventoryCountDetail): void {
  try {
    kv.setItem(detailKey(detail.id), JSON.stringify(detail));
  } catch {
    // не критично
  }
}

export function loadCachedDetail(kv: KV, countId: string): InventoryCountDetail | null {
  try {
    const raw = kv.getItem(detailKey(countId));
    return raw ? (JSON.parse(raw) as InventoryCountDetail) : null;
  } catch {
    return null;
  }
}
