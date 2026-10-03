"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import { InventoryApiError, inventoryApi } from "@admin/lib/inventory-api";
import type { InventoryCountDetail } from "@backend/modules/inventory/types";
import {
  applyResult,
  cacheDetail,
  classifySyncError,
  loadCachedDetail,
  loadQueue,
  overlay,
  pendingOps,
  pruneConfirmed,
  rejectAll,
  rejectedAddCount,
  retryRejected,
  saveQueue,
  type KV,
  type QueuedOp,
} from "./queue";

const BATCH = 200;
const REFETCH_MS = 10_000;
const RETRY_MS = 5_000;
// Столько подряд неудачных отправок — и считаем, что сети нет, даже если
// navigator.onLine говорит обратное (Wi-Fi склада без интернета).
const OFFLINE_AFTER_FAILURES = 2;

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

// Ответ GET вместе с моментом, когда запрос начался: подтверждённые операции
// убираем из очереди, только если GET начался после их подтверждения.
type Fetched = InventoryCountDetail & { fetchStartedAt: number };

export function useCountSync(countId: string, youLabel: string) {
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["inventory_count", countId], [countId]);
  const [queue, setQueueState] = useState<QueuedOp[]>(() => loadQueue(storage(), countId));
  const [browserOnline, setBrowserOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );
  const [failures, setFailures] = useState(0);
  const [authExpired, setAuthExpired] = useState(false);
  const queueRef = useRef(queue);
  const flushing = useRef(false);
  const alive = useRef(true);
  const followUp = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  // queueRef обновляется вместе с состоянием, а не только на рендере:
  // таймеры читают его и после размонтирования не должны видеть старую очередь.
  const setQueue = useCallback((fn: (q: QueuedOp[]) => QueuedOp[]) => {
    setQueueState((q) => {
      const next = fn(q);
      queueRef.current = next;
      return next;
    });
  }, []);

  const query = useQuery<Fetched>({
    queryKey,
    queryFn: async () => {
      const fetchStartedAt = Date.now();
      const d = await inventoryApi.getCount(countId);
      cacheDetail(storage(), d);
      return { ...d, fetchStartedAt };
    },
    initialData: () => {
      const cached = loadCachedDetail(storage(), countId);
      return cached ? { ...cached, fetchStartedAt: 0 } : undefined;
    },
    initialDataUpdatedAt: 0,
    refetchInterval: REFETCH_MS,
  });

  useEffect(() => saveQueue(storage(), countId, queue), [countId, queue]);

  // Успешный GET отражает всё, что сервер подтвердил до его начала.
  const fetchStartedAt = query.data?.fetchStartedAt ?? 0;
  useEffect(() => {
    if (fetchStartedAt > 0) setQueue((q) => pruneConfirmed(q, fetchStartedAt));
  }, [fetchStartedAt, setQueue]);

  useEffect(() => {
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const flush = useCallback(async () => {
    if (flushing.current || !alive.current) return;
    const ops = pendingOps(queueRef.current).slice(0, BATCH);
    if (!ops.length) return;
    flushing.current = true;
    let succeeded = false;
    try {
      const result = await inventoryApi.sync(countId, ops);
      succeeded = true;
      setFailures(0);
      setAuthExpired(false);
      setQueue((q) => applyResult(q, result, Date.now()));
      void qc.invalidateQueries({ queryKey });
    } catch (e) {
      const status = e instanceof InventoryApiError ? e.status : 0;
      const action = classifySyncError(status);
      if (action.kind === "reject") {
        setFailures(0);
        setQueue((q) => rejectAll(q, ops.map((o) => o.id), action.reason));
        void qc.invalidateQueries({ queryKey });
      } else if (action.kind === "auth") {
        setAuthExpired(true);
      } else {
        setFailures((n) => n + 1);
      }
      // Ошибки повторяет только 5-секундный таймер — без частого цикла.
    } finally {
      flushing.current = false;
      // После успеха сразу добираем остаток очереди (могли добавиться записи).
      if (succeeded && alive.current && pendingOps(queueRef.current).length) {
        followUp.current = setTimeout(() => void flushRef.current(), 300);
      }
    }
  }, [countId, qc, queryKey, setQueue]);
  flushRef.current = flush;

  // Новая запись — сразу попытка отправить (если сеть вообще есть).
  useEffect(() => {
    if (browserOnline && pendingOps(queue).length) void flush();
  }, [queue, browserOnline, flush]);

  useEffect(() => {
    alive.current = true;
    const t = setInterval(() => {
      if (pendingOps(queueRef.current).length) void flushRef.current();
    }, RETRY_MS);
    return () => {
      alive.current = false;
      clearInterval(t);
      if (followUp.current) clearTimeout(followUp.current);
    };
  }, []);

  const addEntries = useCallback(
    (lineId: string, values: number[]) => {
      const now = new Date().toISOString();
      setQueue((q) => [
        ...q,
        ...values.map(
          (qty): QueuedOp => ({
            state: "pending",
            op: { op: "add", id: uuidv4(), line_id: lineId, qty, client_created_at: now },
          })
        ),
      ]);
    },
    [setQueue]
  );

  const deleteEntry = useCallback(
    (id: string) => setQueue((q) => [...q, { state: "pending", op: { op: "delete", id } }]),
    [setQueue]
  );

  const dismissRejected = useCallback(() => setQueue((q) => q.filter((x) => x.state !== "rejected")), [setQueue]);
  const resendRejected = useCallback(() => setQueue(retryRejected), [setQueue]);

  const detail = useMemo(() => (query.data ? overlay(query.data, queue, youLabel) : undefined), [query.data, queue, youLabel]);

  return {
    detail,
    isLoading: query.isLoading,
    error: query.error,
    online: browserOnline && failures < OFFLINE_AFTER_FAILURES,
    authExpired,
    pendingCount: pendingOps(queue).length,
    rejectedCount: query.data ? rejectedAddCount(query.data, queue) : 0,
    addEntries,
    deleteEntry,
    dismissRejected,
    resendRejected,
    refetch: query.refetch,
  };
}
