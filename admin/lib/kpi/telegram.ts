// Привязка Telegram в настройках KPI: чистые помощники для списков и подписей.

import type { TgBindingRow } from "@admin/lib/kpi-api";
import { formatTashkent } from "@admin/lib/kpi/format";
import { ruT, type KpiT } from "@admin/lib/kpi/i18n";

/** Сервер принимает до 200 id в одном запросе; берём по 100 с запасом. */
const CHUNK = 100;

/** Без повторов и пустых, пачками по `size`. */
export function chunkIds(ids: readonly string[], size = CHUNK): string[][] {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out: string[][] = [];
  for (let i = 0; i < uniq.length; i += size) out.push(uniq.slice(i, i + size));
  return out;
}

export function indexBindings(rows: readonly TgBindingRow[]): { employee: Map<string, TgBindingRow>; user: Map<string, TgBindingRow> } {
  const employee = new Map<string, TgBindingRow>();
  const user = new Map<string, TgBindingRow>();
  for (const r of rows) {
    if (r.employee_id) employee.set(r.employee_id, r);
    else if (r.user_id) user.set(r.user_id, r);
  }
  return { employee, user };
}

export function bindingLabel(b: TgBindingRow | undefined, t: KpiT = ruT): string {
  return b ? t("lib.telegram.bound", { lang: b.lang === "uz" ? "UZ" : "RU" }) : t("lib.telegram.unbound");
}

export function inviteHint(expiresAt: string, t: KpiT = ruT): string {
  return t("lib.telegram.invite", { date: formatTashkent(expiresAt) });
}
