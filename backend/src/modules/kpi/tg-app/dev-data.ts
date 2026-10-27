// Данные для тестов мини-приложения и smoke-стенда (план 7). Роуты этот файл не импортируют.
// Пишут напрямую в таблицы, мимо доменных проверок, поэтому работают только под тестовым
// и smoke-префиксом: на боевой базе они не запустятся.
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { DrizzleDB } from "@backend/lib/db";
import {
  employees,
  kpi_card_items,
  kpi_disputes,
  kpi_raise_decisions,
  kpi_review_events,
  kpi_review_items,
  kpi_reviews,
  kpi_violation_photos,
  kpi_violations,
} from "backend/drizzle/schema";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { DbLike } from "../access";
import { now } from "../clock";
import { getTiers } from "../raises";
import { quarterRow, scorePct, type ItemSource } from "../rules";
import { loadSettings } from "../settings";
import { uploadsBase } from "../storage";
import { quarterMonths, type Period } from "../time";

// PNG 1×1, прозрачный пиксель.
export const TINY_PNG: Uint8Array = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64")
);

function onlyTestPrefix(): void {
  const p = process.env.PROJECT_PREFIX;
  if (p !== "managers_test_" && p !== "managers_smoke_") throw new Error("dev-data: только managers_test_ и managers_smoke_");
}

const inTx = <T>(db: DbLike, fn: (tx: DbLike) => Promise<T>): Promise<T> =>
  (db as DrizzleDB).transaction((tx) => fn(tx));

const pctStr = (v: number | null): string | null => (v === null ? null : v.toFixed(2));

// Оценка со снимками активных пунктов карты (по sort). Черновик тоже получает score_pct, как в жизни,
// но без submitted_at. change — оценку меняли после отправки: version 2 и событие changed.
export async function seedReview(
  db: DbLike,
  o: {
    employee_id: string;
    terminal_id: string;
    card_id: string;
    evaluator_user_id: string;
    period: Period;
    scores: (number | null)[];
    notes?: (string | null)[];
    status?: "draft" | "submitted";
    // items — какие пункты (по номеру в карте) правка изменила: попадают в changes события, как у reviews.ts.
    change?: { old_score_pct: number; comment: string; items?: { index: number; old: number | null; new: number | null }[] };
  }
): Promise<{ id: string; score_pct: number | null; item_ids: string[] }> {
  onlyTestPrefix();
  const status = o.status ?? "submitted";
  return inTx(db, async (tx) => {
    const card = await tx
      .select()
      .from(kpi_card_items)
      .where(and(eq(kpi_card_items.card_id, o.card_id), eq(kpi_card_items.active, true)))
      .orderBy(asc(kpi_card_items.sort), asc(kpi_card_items.created_at));
    const rows = card.map((c, i) => ({
      item_id: c.id,
      title_ru: c.title_ru,
      title_uz: c.title_uz,
      weight: c.weight,
      source: c.source as ItemSource,
      score: o.scores[i] ?? null,
      note: o.notes?.[i] ?? null,
    }));
    const pct = scorePct(rows);
    const at = now().toISOString();
    const [review] = await tx
      .insert(kpi_reviews)
      .values({
        period: o.period,
        employee_id: o.employee_id,
        terminal_id: o.terminal_id,
        card_id: o.card_id,
        evaluator_user_id: o.evaluator_user_id,
        status,
        score_pct: pctStr(pct),
        submitted_at: status === "submitted" ? at : null,
        version: o.change ? 2 : 1,
      })
      .returning({ id: kpi_reviews.id });
    if (rows.length) {
      await tx.insert(kpi_review_items).values(rows.map((r) => ({ review_id: review.id, ...r })));
    }
    if (o.change) {
      await tx.insert(kpi_review_events).values({
        review_id: review.id,
        actor_kind: "user",
        actor_user_id: o.evaluator_user_id,
        kind: "changed",
        changes: (o.change.items ?? []).map((c) => ({ item_id: rows[c.index].item_id, old: c.old, new: c.new, title_ru: rows[c.index].title_ru })),
        old_score_pct: pctStr(o.change.old_score_pct),
        new_score_pct: pctStr(pct),
        comment: o.change.comment,
      });
    }
    return { id: review.id, score_pct: pct, item_ids: rows.map((r) => r.item_id) };
  });
}

// Нарушение; название пункта — снимок из card_item_id. С photo файл ложится в
// ${uploadsBase()}/<violation_id>/<uuid>.png, как у savePhoto.
export async function seedViolation(
  db: DbLike,
  o: {
    employee_id: string;
    terminal_id: string;
    recorded_by: string;
    period: Period;
    occurred_at: string;
    card_item_id?: string | null;
    comment?: string;
    status?: "active" | "cancelled";
    cancel_reason?: string;
    photo?: Uint8Array | null;
  }
): Promise<{ id: string; photo_id: string | null }> {
  onlyTestPrefix();
  const itemId = o.card_item_id ?? null;
  let title: string | null = null;
  if (itemId) {
    const [it] = await db.select({ title_ru: kpi_card_items.title_ru }).from(kpi_card_items).where(eq(kpi_card_items.id, itemId));
    title = it?.title_ru ?? null;
  }
  const cancelled = o.status === "cancelled";
  const at = now().toISOString();
  const id = randomUUID();
  await db.insert(kpi_violations).values({
    id,
    terminal_id: o.terminal_id,
    employee_id: o.employee_id,
    card_item_id: itemId,
    item_title_ru: title,
    period: o.period,
    occurred_at: o.occurred_at,
    comment: o.comment ?? "Тест нарушение",
    recorded_by: o.recorded_by,
    status: cancelled ? "cancelled" : "active",
    cancelled_by: cancelled ? o.recorded_by : null,
    cancelled_at: cancelled ? at : null,
    cancel_reason: cancelled ? (o.cancel_reason ?? null) : null,
  });
  if (!o.photo) return { id, photo_id: null };
  const dir = `${uploadsBase()}/${id}`;
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
  const file_path = `${dir}/${randomUUID()}.png`;
  fs.writeFileSync(file_path, o.photo);
  const [photo] = await db
    .insert(kpi_violation_photos)
    .values({ violation_id: id, file_path, mime: "image/png", size_bytes: o.photo.byteLength })
    .returning({ id: kpi_violation_photos.id });
  return { id, photo_id: photo.id };
}

// Спор от имени сотрудника. Разобранный получает resolved_at = now().
export async function seedDispute(
  db: DbLike,
  o: {
    subject_type: "review" | "violation";
    subject_id: string;
    employee_id: string;
    period: Period;
    status?: "open" | "accepted" | "rejected";
    resolution_comment?: string | null;
    via?: "admin" | "telegram" | "miniapp";
  }
): Promise<{ id: string }> {
  onlyTestPrefix();
  const status = o.status ?? "open";
  const resolved = status !== "open";
  const [row] = await db
    .insert(kpi_disputes)
    .values({
      subject_type: o.subject_type,
      subject_id: o.subject_id,
      employee_id: o.employee_id,
      period: o.period,
      opened_via: o.via ?? "telegram",
      opened_by_user_id: null,
      reason: "Тест спор: не согласен",
      status,
      resolution_comment: resolved ? (o.resolution_comment ?? null) : null,
      resolved_at: resolved ? now().toISOString() : null,
    })
    .returning({ id: kpi_disputes.id });
  return { id: row.id };
}

// Строка решения о прибавке в том же виде, что пишет computeQuarter: months — { period, score_pct }[],
// итоги через quarterRow по текущей шкале. approved_amount и decided_at — только у approved и rejected.
export async function seedDecision(
  db: DbLike,
  o: {
    quarter_start: Period;
    employee_id: string;
    months: (number | null)[];
    status: "proposed" | "insufficient" | "approved" | "rejected";
    amount?: number;
    comment?: string;
  }
): Promise<void> {
  onlyTestPrefix();
  const periods = quarterMonths(o.quarter_start);
  const months = periods.map((period, i) => ({ period, score_pct: o.months[i] ?? null }));
  const settings = await loadSettings(db);
  const row = quarterRow(months.map((m) => m.score_pct), await getTiers(db), settings.raise_min_months);
  // Снимок филиала и карты — по последней отправленной оценке квартала, как у computeQuarter;
  // без оценок — текущий филиал сотрудника и без карты.
  const [latest] = await db
    .select({ terminal_id: kpi_reviews.terminal_id, card_id: kpi_reviews.card_id })
    .from(kpi_reviews)
    .where(and(eq(kpi_reviews.employee_id, o.employee_id), eq(kpi_reviews.status, "submitted"), inArray(kpi_reviews.period, periods)))
    .orderBy(desc(kpi_reviews.period))
    .limit(1);
  const [emp] = latest
    ? [null]
    : await db.select({ terminal_id: employees.terminal_id }).from(employees).where(eq(employees.id, o.employee_id));
  const decided = o.status === "approved" || o.status === "rejected";
  const amount = o.status === "approved" ? (o.amount ?? row.suggested_amount) : 0;
  const at = now().toISOString();
  const values = {
    terminal_id: latest?.terminal_id ?? emp?.terminal_id ?? null,
    card_id: latest?.card_id ?? null,
    months,
    months_scored: row.months_scored,
    avg_pct: pctStr(row.avg_pct),
    suggested_amount: String(row.suggested_amount),
    status: o.status,
    approved_amount: decided ? String(amount) : null,
    decided_at: decided ? at : null,
    comment: o.comment ?? null,
    computed_at: at,
    updated_at: at,
  };
  await db
    .insert(kpi_raise_decisions)
    .values({ quarter_start: o.quarter_start, employee_id: o.employee_id, ...values })
    .onConflictDoUpdate({ target: [kpi_raise_decisions.quarter_start, kpi_raise_decisions.employee_id], set: values });
}
