"use client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { DAY, normalizeProductName, tierOf, type Tier } from "./format";

export type BoardItem = {
  id: string;
  brand: string;
  terminal_id: number;
  terminal_name: string | null;
  managers_terminal_id: string | null;
  managers_terminal_name: string | null;
  product_id: number;
  product_name: string | null;
  started_at: string;
  last_balance: number | null;
  seconds_stopped: number;
  times_30d: number;
};

export type BoardResponse = {
  synced_at: string | null;
  stats: { released_today: number; stops_today: number };
  items: BoardItem[];
};

// One product (variants collapsed) stopped at one terminal.
export type Position = {
  key: string;
  name: string;
  variants: BoardItem[];
  seconds: number; // longest variant
  started_at: string; // earliest variant
  times_30d: number;
  tier: Tier;
};

// Everything that went on stop at one terminal within the same minute.
export type Incident = {
  key: string;
  started_at: string;
  seconds: number;
  positions: Position[];
};

export type TerminalGroup = {
  key: string;
  brand: string;
  terminal_id: number;
  name: string;
  managersName: string | null;
  managersId: string | null;
  fresh: Incident[];
  stale: Position[];
  chronic: Position[];
  freshCount: number;
  staleCount: number;
  chronicCount: number;
  total: number;
  maxFreshSeconds: number;
  score: number;
};

export type ProductGroup = {
  key: string;
  name: string;
  brand: string;
  terminals: { terminal: TerminalGroup; position: Position }[];
  freshCount: number;
  maxSeconds: number;
};

export type BoardKpi = {
  fresh: number;
  terminalsBurning: number;
  stale: number;
  chronic: number;
};

export function useBoard(brand: string | null) {
  return useQuery<BoardResponse>({
    queryKey: ["stoplist_board", brand],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (brand) params.set("brand", brand);
      const res = await fetch(`/api/stoplist/board?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

function minuteKey(iso: string): string {
  return iso.slice(0, 16); // "2026-09-03T10:05" (server sends tz-aware ISO)
}

function buildPositions(items: BoardItem[]): Position[] {
  const map = new Map<string, Position>();
  for (const it of items) {
    const name = normalizeProductName(it.product_name) || `#${it.product_id}`;
    const key = name.toLowerCase();
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        key,
        name,
        variants: [it],
        seconds: it.seconds_stopped,
        started_at: it.started_at,
        times_30d: it.times_30d,
        tier: tierOf(it.seconds_stopped),
      });
    } else {
      cur.variants.push(it);
      if (it.seconds_stopped > cur.seconds) cur.seconds = it.seconds_stopped;
      if (it.started_at < cur.started_at) cur.started_at = it.started_at;
      if (it.times_30d > cur.times_30d) cur.times_30d = it.times_30d;
      cur.tier = tierOf(cur.seconds);
    }
  }
  return [...map.values()];
}

function buildIncidents(positions: Position[]): Incident[] {
  const map = new Map<string, Incident>();
  for (const p of positions) {
    const k = minuteKey(p.started_at);
    const cur = map.get(k);
    if (!cur) {
      map.set(k, { key: k, started_at: p.started_at, seconds: p.seconds, positions: [p] });
    } else {
      cur.positions.push(p);
      if (p.seconds > cur.seconds) cur.seconds = p.seconds;
    }
  }
  const list = [...map.values()];
  for (const inc of list) inc.positions.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  // newest incident first: that is what just happened
  list.sort((a, b) => (a.started_at < b.started_at ? 1 : -1));
  return list;
}

export function buildBoard(items: BoardItem[] | undefined, search: string) {
  const q = search.trim().toLowerCase();
  const filtered = !q
    ? items ?? []
    : (items ?? []).filter(
        (i) =>
          (i.product_name ?? "").toLowerCase().includes(q) ||
          (i.terminal_name ?? "").toLowerCase().includes(q) ||
          (i.managers_terminal_name ?? "").toLowerCase().includes(q)
      );

  const byTerminal = new Map<string, BoardItem[]>();
  for (const it of filtered) {
    const k = `${it.brand}|${it.terminal_id}`;
    const arr = byTerminal.get(k);
    if (arr) arr.push(it);
    else byTerminal.set(k, [it]);
  }

  const terminals: TerminalGroup[] = [];
  for (const [key, list] of byTerminal) {
    const positions = buildPositions(list);
    const freshPos = positions.filter((p) => p.tier === "fresh");
    const stale = positions
      .filter((p) => p.tier === "stale")
      .sort((a, b) => b.seconds - a.seconds);
    const chronic = positions
      .filter((p) => p.tier === "chronic")
      .sort((a, b) => b.seconds - a.seconds);
    const fresh = buildIncidents(freshPos);
    const maxFreshSeconds = freshPos.reduce((m, p) => Math.max(m, p.seconds), 0);
    const first = list[0];
    terminals.push({
      key,
      brand: first.brand,
      terminal_id: first.terminal_id,
      name: first.terminal_name ?? `#${first.terminal_id}`,
      managersName: first.managers_terminal_name,
      managersId: first.managers_terminal_id,
      fresh,
      stale,
      chronic,
      freshCount: freshPos.length,
      staleCount: stale.length,
      chronicCount: chronic.length,
      total: positions.length,
      maxFreshSeconds,
      // fresh stops are what the warehouse can still change today
      score: freshPos.length * 3 + stale.length + chronic.length * 0.1,
    });
  }
  terminals.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ru"));

  const byProduct = new Map<string, ProductGroup>();
  for (const t of terminals) {
    const all: Position[] = [...t.fresh.flatMap((i) => i.positions), ...t.stale, ...t.chronic];
    for (const p of all) {
      const k = `${t.brand}|${p.key}`;
      const cur = byProduct.get(k);
      const entry = { terminal: t, position: p };
      if (!cur) {
        byProduct.set(k, {
          key: k,
          name: p.name,
          brand: t.brand,
          terminals: [entry],
          freshCount: p.tier === "fresh" ? 1 : 0,
          maxSeconds: p.seconds,
        });
      } else {
        cur.terminals.push(entry);
        if (p.tier === "fresh") cur.freshCount += 1;
        if (p.seconds > cur.maxSeconds) cur.maxSeconds = p.seconds;
      }
    }
  }
  const products = [...byProduct.values()];
  for (const p of products) p.terminals.sort((a, b) => b.position.seconds - a.position.seconds);
  products.sort(
    (a, b) =>
      b.terminals.length - a.terminals.length ||
      b.freshCount - a.freshCount ||
      a.name.localeCompare(b.name, "ru")
  );

  const kpi: BoardKpi = {
    fresh: terminals.reduce((s, t) => s + t.freshCount, 0),
    terminalsBurning: terminals.filter((t) => t.freshCount > 0).length,
    stale: terminals.reduce((s, t) => s + t.staleCount, 0),
    chronic: terminals.reduce((s, t) => s + t.chronicCount, 0),
  };

  return { terminals, products, kpi };
}

export function useBoardModel(items: BoardItem[] | undefined, search: string) {
  return useMemo(() => buildBoard(items, search), [items, search]);
}

export const isFreshSeconds = (s: number) => s < DAY;
