import type {
  InventoryCountDetail,
  InventoryEntry,
  InventoryLine,
  InventorySyncOp,
  InventorySyncResult,
} from "@backend/modules/inventory/types";
import { sumQty } from "./qty";

export type QueuedOp = { op: InventorySyncOp; state: "pending" | "rejected"; reason?: string };

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

export function pendingOps(q: QueuedOp[]): InventorySyncOp[] {
  return q.filter((x) => x.state === "pending").map((x) => x.op);
}

export function applyResult(q: QueuedOp[], r: InventorySyncResult): QueuedOp[] {
  const applied = new Set(r.applied);
  const rejected = new Map(r.rejected.map((x) => [x.id, x.reason]));
  const out: QueuedOp[] = [];
  for (const item of q) {
    if (item.state !== "pending") {
      out.push(item);
      continue;
    }
    if (rejected.has(item.op.id)) {
      out.push({ ...item, state: "rejected", reason: rejected.get(item.op.id) });
      continue;
    }
    if (applied.has(item.op.id)) continue;
    out.push(item);
  }
  return out;
}

export function rejectAll(q: QueuedOp[], ids: string[], reason: string): QueuedOp[] {
  const set = new Set(ids);
  return q.map((item) => (item.state === "pending" && set.has(item.op.id) ? { ...item, state: "rejected", reason } : item));
}

export type OverlayEntry = InventoryEntry & { pending?: boolean };
export type OverlayLine = Omit<InventoryLine, "entries"> & { entries: OverlayEntry[] };
export type OverlayDetail = Omit<InventoryCountDetail, "lines"> & { lines: OverlayLine[] };

export function isLineDone(line: OverlayLine): boolean {
  return line.skipped || line.entries.length > 0;
}

// Ответ сервера + ещё не отправленные операции этого устройства.
export function overlay(detail: InventoryCountDetail, q: QueuedOp[], youLabel: string): OverlayDetail {
  const pending = q.filter((x) => x.state === "pending").map((x) => x.op);
  const deleted = new Set(pending.filter((o) => o.op === "delete").map((o) => o.id));
  const serverIds = new Set(detail.lines.flatMap((l) => l.entries.map((e) => e.id)));
  const addsByLine = new Map<string, OverlayEntry[]>();
  for (const o of pending) {
    if (o.op !== "add" || serverIds.has(o.id) || deleted.has(o.id)) continue;
    const list = addsByLine.get(o.line_id) ?? [];
    list.push({
      id: o.id,
      line_id: o.line_id,
      qty: String(o.qty),
      created_by: detail.viewer_id,
      created_by_name: youLabel,
      client_created_at: o.client_created_at,
      pending: true,
    });
    addsByLine.set(o.line_id, list);
  }
  const lines: OverlayLine[] = detail.lines.map((l) => {
    const entries: OverlayEntry[] = [...l.entries.filter((e) => !deleted.has(e.id)), ...(addsByLine.get(l.id) ?? [])];
    return { ...l, entries, total: sumQty(entries.map((e) => e.qty)) };
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
