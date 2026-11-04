// Форма записи нарушения как данные (без DOM): что не так с черновиком и как собрать multipart.
import type { EvViolationForm } from "@backend/modules/kpi/tg-app/ev-types";
import { reasonCount } from "../util";

export interface ViolationDraft { item_id: string | null; comment: string; photos: File[] }
export type ViolationIssue = "comment" | "photo_required" | "too_many_photos";

export function violationIssues(d: ViolationDraft, f: EvViolationForm): ViolationIssue[] {
  const out: ViolationIssue[] = [];
  if (reasonCount(d.comment) < f.comment_min) out.push("comment");
  if (f.photo_required && d.photos.length === 0) out.push("photo_required");
  if (d.photos.length > f.max_photos) out.push("too_many_photos");
  return out;
}

export function buildViolationForm(employeeId: string, d: ViolationDraft): FormData {
  const fd = new FormData();
  fd.append("employee_id", employeeId);
  if (d.item_id) fd.append("card_item_id", d.item_id);
  fd.append("comment", d.comment.trim());
  for (const p of d.photos) fd.append("photos", p);
  return fd;
}
