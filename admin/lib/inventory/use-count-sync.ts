"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { InventoryApiError, inventoryApi } from "@admin/lib/inventory-api";
import {
  applyResult,
  cacheDetail,
  loadCachedDetail,
  loadQueue,
  overlay,
  pendingOps,
  rejectAll,
  saveQueue,
  type KV,
  type QueuedOp,
} from "./queue";

const BATCH = 200;
const REFETCH_MS = 10_000;
const RETRY_MS = 5_000;

// localStorage может бросать (приватный режим, запрет сайта) — тогда память вкладки.
const memory = new Map<string, string>();
const memoryKV: KV = {
  getItem: (k) => memory.get(k) ?? null,
  setItem: (k, v) => void memory.set(k, v),
  removeItem: (k) => void memory.delete(k),
};
function storage(): KV {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const probe = "__inventory_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return window.localStorage;
    }
  } catch {
    // падаем в память
  }
  return memoryKV;
}

export function useCountSync(countId: string, youLabel: string) {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["inventory_count", countId], [countId]);
  const [queue, setQueue] = useState<QueuedOp[]>(() => loadQueue(storage(), countId));
  const [online, setOnline] = useState<boolean>(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const flushing = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const d = await inventoryApi.getCount(countId);
      cacheDetail(storage(), d);
      return d;
    },
    initialData: () => loadCachedDetail(storage(), countId) ?? undefined,
    initialDataUpdatedAt: 0,
    refetchInterval: REFETCH_MS,
  });

  useEffect(() => saveQueue(storage(), countId, queue), [countId, queue]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current) return;
    const ops = pendingOps(queueRef.current).slice(0, BATCH);
    if (!ops.length) return;
    flushing.current = true;
    try {
      const result = await inventoryApi.sync(countId, ops);
      setOnline(true);
      // Сначала свежий ответ сервера, потом чистим очередь: иначе на время
      // перезапроса принятые записи пропадают с экрана. Двойного счёта нет —
      // overlay() пропускает операции, чьи id уже пришли от сервера.
      await qc.invalidateQueries({ queryKey });
      setQueue((q) => applyResult(q, result));
    } catch (e) {
      if (e instanceof InventoryApiError && (e.status === 409 || e.status === 403)) {
        setQueue((q) => rejectAll(q, ops.map((o) => o.id), e.status === 409 ? "not_draft" : "forbidden"));
        void qc.invalidateQueries({ queryKey });
      } else if (typeof navigator !== "undefined" && !navigator.onLine) {
        setOnline(false);
      }
      // Иначе сетевая ошибка: операции остаются pending, повтор по таймеру.
    } finally {
      flushing.current = false;
      // Пока шла пачка, могли добавиться новые операции.
      setTimeout(() => {
        if (pendingOps(queueRef.current).length) void flushRef.current();
      }, 300);
    }
  }, [countId, qc, queryKey]);
  flushRef.current = flush;

  useEffect(() => {
    if (online && pendingOps(queue).length) void flush();
  }, [queue, online, flush]);

  useEffect(() => {
    const t = setInterval(() => {
      if (pendingOps(queueRef.current).length) void flushRef.current();
    }, RETRY_MS);
    return () => clearInterval(t);
  }, []);

  const addEntries = useCallback((lineId: string, values: number[]) => {
    const now = new Date().toISOString();
    setQueue((q) => [
      ...q,
      ...values.map(
        (qty): QueuedOp => ({ state: "pending", op: { op: "add", id: uuidv4(), line_id: lineId, qty, client_created_at: now } })
      ),
    ]);
  }, []);

  const deleteEntry = useCallback((id: string) => {
    setQueue((q) => [...q, { state: "pending", op: { op: "delete", id } }]);
  }, []);

  const dismissRejected = useCallback(() => setQueue((q) => q.filter((x) => x.state !== "rejected")), []);

  const detail = useMemo(() => (query.data ? overlay(query.data, queue, youLabel) : undefined), [query.data, queue, youLabel]);

  return {
    detail,
    isLoading: query.isLoading,
    error: query.error,
    online,
    pendingCount: pendingOps(queue).length,
    rejectedCount: queue.filter((x) => x.state === "rejected" && x.op.op === "add").length,
    addEntries,
    deleteEntry,
    dismissRejected,
    refetch: query.refetch,
  };
}
