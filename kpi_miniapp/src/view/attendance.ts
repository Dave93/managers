// «Моя посещаемость» как данные (без DOM): что рисует screens/attendance.ts. Дни — в порядке
// ответа сервера (новыми сверху), сверху название месяца и переключатель на соседние месяцы,
// у которых есть данные (prev/next приходят с сервера, null — соседа нет).
//
// Время — по Ташкенту через hhmm. Метка дня строится из строки «YYYY-MM-DD» без Date: день уже
// календарный, и сдвиг часового пояса не должен менять число. «Не вышел» — только при
// absent = true: времена и опоздание тогда не показываем, даже если они лежат в данных.
import type { TgAttendance, TgAttendanceDay } from "@backend/modules/kpi/tg-app/types";
import { hhmm } from "../format";
import { type Lang, monthName, tIn } from "../i18n";
import { hashOf } from "../route";
import { capFirst } from "../util";

const DASH = "—";

export interface AttendanceRowVM {
  day: string; // «3 ноября» / «3-noyabr»
  absent: string | null; // «не вышел», только при absent = true
  times: { in: string; out: string } | null; // «08:55» | «нет отметки» | «—»; у absent null
  late: string | null; // «опоздание 12 мин», только при late_minutes > 0 и не absent
}
export interface AttendanceNavVM {
  label: string; // «Октябрь»; с годом, если сосед не соседний по календарю или в другом году: «Август 2026»
  hash: string;
  aria: string;
}
export interface AttendanceVM {
  title: string; // «Моя посещаемость»
  month: string; // «Ноябрь 2026»
  prev: AttendanceNavVM | null;
  next: AttendanceNavVM | null;
  empty: string | null; // «Данных за месяц нет», когда days пуст
  rows: AttendanceRowVM[]; // в порядке ответа сервера
}

/** «3 ноября» / «3-noyabr» из «2026-11-03», без Date. */
function dayLabel(day: string, l: Lang): string {
  const n = Number(day.slice(8, 10));
  return l === "ru" ? `${n} ${monthName(day, "gen", "ru")}` : `${n}-${monthName(day, "gen", "uz")}`;
}

function timesOf(d: TgAttendanceDay, l: Lang): { in: string; out: string } {
  // Обеих отметок нет — прочерки; одной не хватает — «нет отметки» (человек мог забыть отметиться).
  if (d.check_in === null && d.check_out === null) return { in: DASH, out: DASH };
  const cell = (iso: string | null): string => (iso === null ? tIn(l, "att_no_mark") : hhmm(Date.parse(iso)));
  return { in: cell(d.check_in), out: cell(d.check_out) };
}

function rowOf(d: TgAttendanceDay, l: Lang): AttendanceRowVM {
  const day = dayLabel(d.day, l);
  if (d.absent) return { day, absent: tIn(l, "att_absent"), times: null, late: null };
  return { day, absent: null, times: timesOf(d, l), late: d.late_minutes > 0 ? tIn(l, "att_late", { n: d.late_minutes }) : null };
}

/** Номер месяца подряд: «2026-11» → год·12 + месяц, чтобы сравнивать соседство через границу года. */
function monthSeq(m: string): number {
  return Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
}

/**
 * Сосед — ближайший месяц с данными, пустые месяцы он перепрыгивает. Год в подписи нужен, когда
 * сосед не соседний по календарю (между ними пропуск) или лежит в другом году («Декабрь 2025»
 * рядом с январём): иначе «Август» у ноября читалось бы как соседний месяц.
 */
function navOf(shown: string, m: string | null, aria: "att_prev" | "att_next", l: Lang): AttendanceNavVM | null {
  if (m === null) return null;
  const plain = Math.abs(monthSeq(m) - monthSeq(shown)) === 1 && m.slice(0, 4) === shown.slice(0, 4);
  const name = capFirst(monthName(m, "nom", l));
  return { label: plain ? name : `${name} ${m.slice(0, 4)}`, hash: hashOf({ name: "attendance", month: m }), aria: tIn(l, aria) };
}

export function attendanceView(d: TgAttendance, l: Lang): AttendanceVM {
  return {
    title: tIn(l, "link_attendance"),
    month: `${capFirst(monthName(d.month, "nom", l))} ${d.month.slice(0, 4)}`,
    prev: navOf(d.month, d.prev, "att_prev", l),
    next: navOf(d.month, d.next, "att_next", l),
    empty: d.days.length === 0 ? tIn(l, "att_empty") : null,
    rows: d.days.map((x) => rowOf(x, l)),
  };
}
