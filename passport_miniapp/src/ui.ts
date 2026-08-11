// Every screen the shell can show, rendered from one place.
//
// There is exactly ONE status screen. It is parameterised by tone, glyph and
// copy, so nine different outcomes cost nine dictionary entries instead of
// nine blocks of markup -- which matters when the whole bundle has to stay in
// single-digit kilobytes for a phone on branch wifi.
import { t, lang, setLang, type Lang, type StatusKey } from "./i18n";

type Tone = "danger" | "warn" | "neutral";

// Stroke glyphs, 24-unit grid, inherited colour. Inline rather than a sprite
// or an icon package: nine paths are smaller than any dependency, and they
// paint with the first frame instead of after a second request.
const ICONS = {
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  ban: '<circle cx="12" cy="12" r="9"/><line x1="6" y1="6" x2="18" y2="18"/>',
  userSwap:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M17 6.5h4l-1.6-1.8M21 11.5h-4l1.6 1.8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  sliders:
    '<line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="10" cy="8" r="2.2"/><circle cx="16" cy="16" r="2.2"/>',
  passport:
    '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 3.5v17"/><path d="M12.5 9.5h3.5M12.5 13h3.5"/>',
  wifiOff:
    '<path d="M2 8.5a16 16 0 0 1 20 0"/><path d="M5 12a11 11 0 0 1 14 0"/><path d="M8.5 15.5a6 6 0 0 1 7 0"/><line x1="12" y1="19" x2="12.01" y2="19"/><line x1="3" y1="3" x2="21" y2="21"/>',
  alert:
    '<path d="M12 4.5 2.8 20h18.4L12 4.5Z"/><line x1="12" y1="10" x2="12" y2="14"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  send: '<path d="M21.5 2.5 10.5 13.5"/><path d="M21.5 2.5 14.5 21.5l-4-8-8-4 19-7Z"/>',
} as const;

type IconKey = keyof typeof ICONS;

// Tone is a claim about WHOSE PROBLEM this is, not decoration:
//   danger  — a wall: this account will not get in until someone acts.
//   warn    — a mix-up or a hiccup: the same person can still fix it.
//   neutral — nothing is broken about you: wrong door, or not your turn yet.
const LOOK: Record<StatusKey, { tone: Tone; icon: IconKey; retry: boolean }> = {
  outside_telegram: { tone: "neutral", icon: "send", retry: false },
  no_access: { tone: "danger", icon: "lock", retry: false },
  banned: { tone: "danger", icon: "ban", retry: false },
  wrong_account: { tone: "warn", icon: "userSwap", retry: false },
  // No retry button on purpose: initData is captured once at launch, so
  // pressing "again" would replay the very same expired blob.
  expired: { tone: "warn", icon: "clock", retry: false },
  not_configured: { tone: "neutral", icon: "sliders", retry: false },
  not_started: { tone: "neutral", icon: "passport", retry: false },
  offline: { tone: "warn", icon: "wifiOff", retry: true },
  unknown: { tone: "warn", icon: "alert", retry: true },
};

const el = (id: string): HTMLElement => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
};

function show(id: "loading" | "view"): void {
  for (const name of ["loading", "view"] as const) {
    const node = el(`screen-${name}`);
    const active = name === id;
    node.hidden = !active;
    node.classList.toggle("screen-active", active);
  }
}

function icon(key: IconKey): string {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    ICONS[key] +
    "</svg>"
  );
}

// textContent everywhere below, never innerHTML, for anything that could carry
// a name from the API later on.
function text(tag: string, cls: string, value: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = value;
  return node;
}

/** What the last render was, so a language switch can repaint it. */
let repaint: (() => void) | null = null;

export function renderStatus(status: StatusKey, onRetry?: () => void): void {
  repaint = () => renderStatus(status, onRetry);
  const look = LOOK[status];
  const copy = t().status[status];
  const view = el("screen-view");
  view.innerHTML = "";
  view.className = "screen screen--center";

  const glyph = document.createElement("div");
  glyph.className = `glyph glyph--${look.tone}`;
  glyph.innerHTML = icon(look.icon);
  view.append(glyph);
  view.append(text("h1", "status-title", copy.title));
  view.append(text("p", "status-body", copy.body));

  if (look.retry && onRetry) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-primary";
    btn.textContent = t().retry;
    btn.addEventListener("click", onRetry);
    view.append(btn);
  }
  show("view");
}

/**
 * Placeholder for the trainee's passport (Task C2 fills it) and for the
 * mentor's queue (Task C4). It states plainly that the content is still being
 * built rather than faking a skeleton that never resolves -- an eternal
 * shimmer reads as a broken app, and this one is going to real branches.
 */
export function renderPlaceholder(role: "trainee" | "mentor"): void {
  repaint = () => renderPlaceholder(role);
  const d = t();
  const view = el("screen-view");
  view.innerHTML = "";
  view.className = "screen screen--top";

  const head = document.createElement("header");
  head.className = "head";
  head.append(text("h1", "head-title", role === "trainee" ? d.passport_title : d.mentor_title));
  head.append(text("span", "chip chip--soon", d.soon));
  view.append(head);

  const card = document.createElement("section");
  card.className = "card";
  card.append(text("p", "card-body", role === "trainee" ? d.passport_body : d.mentor_body));
  if (role === "mentor") card.append(text("p", "card-note", d.mentor_signoff_note));
  view.append(card);
  show("view");
}

export function renderLoading(): void {
  repaint = null;
  show("loading");
}

/** The slow-network line under the skeleton; text depends on the language. */
export function setSlowHint(visible: boolean): void {
  const hint = el("loading-hint");
  hint.textContent = t().loading_slow;
  hint.hidden = !visible;
}

export function mountLangPanel(): void {
  const panel = el("lang-panel");
  panel.hidden = false;
  const paint = () => {
    for (const btn of panel.querySelectorAll<HTMLButtonElement>("button[data-lang]")) {
      const active = btn.dataset["lang"] === lang();
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    }
  };
  panel.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-lang]");
    const next = btn?.dataset["lang"];
    if (next !== "ru" && next !== "uz") return;
    if (next === lang()) return;
    setLang(next as Lang, true);
    paint();
    setSlowHint(!el("loading-hint").hidden);
    repaint?.();
  });
  paint();
}
