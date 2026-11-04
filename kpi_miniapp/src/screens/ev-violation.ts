// Запись нарушения: пункт карты, комментарий, фото. Фото готовятся при выборе (сжатие, проверка «это
// картинка»), в запрос идёт только готовое. Нет связи при отправке — результат неизвестен: запись не
// идемпотентна, поэтому повторно сама не уходит, а человек сначала смотрит «Мои нарушения».
// Строки с сервера и имена файлов попадают в DOM только текстом через h().
import type { EvViolationForm } from "@backend/modules/kpi/tg-app/ev-types";
import { appApi } from "../api";
import { reasonCounter } from "../counter";
import { lang, t } from "../i18n";
import { back, navigate } from "../nav";
import { browserIO } from "../photo-pick";
import { preparePhoto } from "../photo-prepare";
import { hashOf, parseHash } from "../route";
import { haptic } from "../telegram";
import { h } from "../ui";
import { latch } from "../util";
import { evOutcome } from "../view/ev-errors";
import { type ViolationDraft, buildViolationForm, violationIssues } from "../view/ev-violation";
import { fill, inAppLink } from "./ev-common";

type Picked = { file: File; url: string };

export function renderEvViolation(f: EvViolationForm): HTMLElement {
  const draft: ViolationDraft = { item_id: null, comment: "", photos: [] };
  const picked: Picked[] = [];
  let preparing = 0;
  let sending = false;
  let blocked = false; // неизвестный исход отправки: до просмотра «Мои нарушения» кнопка закрыта
  const busy = latch();
  const l = lang();

  const select = h("select", { class: "ev-field", "aria-label": t("ev_viol_item"), onchange: (e: Event) => { draft.item_id = (e.target as HTMLSelectElement).value || null; } },
    h("option", { value: "" }, t("ev_viol_item_none")),
    ...f.items.map((i) => h("option", { value: i.id }, l === "uz" && i.title_uz.trim() ? i.title_uz : i.title_ru)));
  const counter = h("p", { class: "ev-hint", "aria-live": "polite" });
  const comment = h("textarea", { class: "ev-field ev-note", rows: "3", "aria-label": t("ev_viol_comment"), placeholder: t("ev_viol_comment_ph"),
    oninput: (e: Event) => { draft.comment = (e.target as HTMLTextAreaElement).value; sync(); } });
  const previews = h("div", { class: "ev-previews" });
  const photoInfo = h("p", { class: "ev-hint", "aria-live": "polite" });
  const notes = h("div", { class: "ev-notes", role: "status" });
  const message = h("p", { class: "ev-msg", role: "status" });
  const unknownLink = inAppLink(hashOf({ name: "ev_violations", period: null }), "ev-link", t("ev_my_violations"));
  const send = h("button", { type: "button", class: "btn btn-primary", onclick: () => void submit() }, t("ev_btn_viol_send")) as HTMLButtonElement;
  unknownLink.addEventListener("click", () => { blocked = false; });
  unknownLink.hidden = true;

  const input = (capture: boolean): HTMLInputElement => {
    const el = h("input", { type: "file", accept: "image/jpeg,image/png", class: "ev-file", tabindex: "-1", "aria-hidden": "true",
      onchange: (e: Event) => { const inp = e.target as HTMLInputElement; const files = inp.files ? Array.prototype.slice.call(inp.files) as File[] : []; void take(files).then(() => { try { inp.value = ""; } catch { /* старые Safari */ } }); } }) as HTMLInputElement;
    if (capture) el.setAttribute("capture", "environment"); else el.multiple = true;
    return el;
  };
  const camera = input(true);
  const gallery = input(false);

  function sync(): void {
    const r = reasonCounter(draft.comment, f.comment_min, null, l);
    counter.textContent = r.ok ? t("ev_viol_comment_min", { min: f.comment_min }) : r.text;
    photoInfo.textContent = [t("ev_photo_count", { n: picked.length, max: f.max_photos }), f.photo_required ? t("ev_photo_required") : "", preparing ? t("ev_photo_busy") : ""].filter(Boolean).join(" · ");
    fill(previews, picked.map((p, i) => h("div", { class: "ev-prev" }, h("img", { src: p.url, alt: "" }),
      h("button", { type: "button", class: "ev-prev-x", "aria-label": t("ev_photo_remove"), onclick: () => { URL.revokeObjectURL(p.url); picked.splice(i, 1); draft.photos = picked.map((x) => x.file); sync(); } }, "×"))));
    send.disabled = violationIssues(draft, f).length > 0 || preparing > 0 || sending || blocked;
  }

  async function take(files: File[]): Promise<void> {
    const problems: string[] = [];
    for (const file of files) {
      if (picked.length + preparing >= f.max_photos) { problems.push(t("ev_photo_err_limit", { max: f.max_photos })); break; }
      preparing++;
      sync();
      let out;
      try { out = await preparePhoto(file, browserIO, f.max_photo_bytes); } catch { out = { ok: false as const, reason: "prepare" as const }; }
      preparing--;
      const label = file.name || "photo";
      if (out.ok) { picked.push({ file: out.file, url: URL.createObjectURL(out.file) }); draft.photos = picked.map((x) => x.file); }
      else problems.push(t(out.reason === "empty" ? "ev_photo_err_empty" : out.reason === "decode" || out.reason === "no_size" ? "ev_photo_err_decode" : out.reason === "too_big" ? "ev_photo_err_big" : "ev_photo_err_prepare", { label, mb: Math.round(f.max_photo_bytes / 1048576) }));
    }
    fill(notes, [...new Set(problems)].map((p) => h("p", { class: "ev-issue" }, p)));
    sync();
  }

  async function submit(): Promise<void> {
    if (!busy.take()) return;
    sending = true;
    message.textContent = "";
    sync();
    try {
      const res = await appApi().sendForm("/ev/violations", buildViolationForm(f.employee.id, draft));
      const out = evOutcome(res, l);
      if (out.kind === "done") {
        haptic("success");
        for (const p of picked) URL.revokeObjectURL(p.url);
        back();
        navigate(parseHash(hashOf({ name: "ev_violations", period: null })));
        return;
      }
      haptic("error");
      if (out.kind === "unknown") { blocked = true; unknownLink.hidden = false; message.textContent = t("ev_err_unknown_outcome"); }
      else if (out.kind === "error" || out.kind === "reload") message.textContent = t(out.key, out.kind === "error" ? out.vars : undefined);
    } finally {
      sending = false;
      busy.release();
      sync();
    }
  }

  const view = h("main", { class: "screen" },
    h("h1", { class: "title" }, t("ev_viol_title", { name: `${f.employee.last_name} ${f.employee.first_name}`.trim() })),
    h("p", { class: "ev-info" }, [f.employee.terminal_name, f.card_title].filter((x): x is string => !!x).join(" · ")),
    h("section", { class: "card ev-item" },
      h("label", { class: "ev-note-label" }, t("ev_viol_item")), select,
      h("label", { class: "ev-note-label" }, t("ev_viol_comment")), comment, counter, h("p", { class: "ev-hint" }, t("ev_viol_comment_note"))),
    h("section", { class: "card ev-item" },
      h("h2", { class: "ev-item-title" }, t("ev_photo_title")),
      h("div", { class: "ev-own-row" },
        h("button", { type: "button", class: "btn btn-quiet", onclick: () => camera.click() }, t("ev_photo_take")),
        h("button", { type: "button", class: "btn btn-quiet", onclick: () => gallery.click() }, t("ev_photo_pick"))),
      photoInfo, previews, notes, camera, gallery),
    send, message, unknownLink);
  sync();
  return view;
}
