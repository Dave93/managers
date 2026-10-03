// Every screen the shell can show, rendered from one place.
//
// There is exactly ONE status screen. It is parameterised by tone, glyph and
// copy, so nine different outcomes cost nine dictionary entries instead of
// nine blocks of markup -- which matters when the whole bundle has to stay in
// single-digit kilobytes for a phone on branch wifi.
import { t, lang, setLang, type Lang, type StatusKey } from "./i18n";

export type Tone = "danger" | "warn" | "neutral" | "good";

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
  // No retry button, and the copy is worded to match: retrying start() would
  // re-read window.Telegram, which stays undefined for the rest of this page
  // load once the SDK fetch has failed. Only reopening the miniapp refetches
  // it, which is what the text asks for.
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

/** Set by mountLangPanel; repainted on every screen change (see below). */
let paintLang: (() => void) | null = null;

function show(id: "loading" | "view"): void {
  for (const name of ["loading", "view"] as const) {
    const node = el(`screen-${name}`);
    const active = name === id;
    node.hidden = !active;
    node.classList.toggle("screen-active", active);
  }
  // The pill is mounted BEFORE the auth exchange (so it works even on the
  // loading screen), but the server's `lang` arrives with the auth response
  // and can move the language out from under it. Without this repaint, a
  // first-time trainee whose binding says `uz` would read Uzbek copy with RU
  // highlighted -- and tapping "O'z" would be a no-op, because the language
  // already IS uz. Every screen change re-syncs the pill.
  paintLang?.();
}

/** The stroke-glyph wrapper. Shared with passport.ts, which owns its own paths. */
export function svgWrap(paths: string): string {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    paths +
    "</svg>"
  );
}

function icon(key: IconKey): string {
  return svgWrap(ICONS[key]);
}

// textContent everywhere below, never innerHTML, for anything that could carry
// a name from the API later on.
export function text(tag: string, cls: string, value: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = value;
  return node;
}

/** What the last render was, so a language switch can repaint it. */
let repaint: (() => void) | null = null;

/**
 * The two lines every screen repeats, exported so screens that live in their
 * own file (passport.ts) cannot forget either of them: clear the view, and
 * register how to repaint it when the language changes. Everything a screen
 * builds hangs off the returned node.
 */
export function beginScreen(cls: string, onRepaint: () => void): HTMLElement {
  repaint = onRepaint;
  const view = el("screen-view");
  view.innerHTML = "";
  view.className = `screen ${cls}`;
  return view;
}

/** Reveal what beginScreen filled in. Always the last line of a renderer. */
export function endScreen(): void {
  show("view");
}

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

// ---------------------------------------------------------------------------
// Shared furniture for the screens that live in their own files (C3's topic and
// quiz). It sits here rather than in one of them because both need it and a
// second copy would be the thing that drifts: two "back" rows with two tap
// heights, two outcome screens with two glyph sizes.
// ---------------------------------------------------------------------------

/**
 * The tinted glyph tile, from raw paths. renderStatus draws its own from the
 * closed ICONS set above; screens that own their vocabulary pass paths in.
 */
export function glyphBox(tone: Tone, paths: string): HTMLElement {
  const node = document.createElement("div");
  node.className = `glyph glyph--${tone}`;
  node.innerHTML = svgWrap(paths);
  return node;
}

export function button(
  cls: string,
  label: string,
  onClick: () => void
): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = cls;
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
}

const BACK_ARROW = '<path d="M15 5l-7 7 7 7"/>';

/**
 * The one way back. A real button in the layout rather than Telegram's
 * BackButton: that API is missing on the older WebViews this audience carries,
 * and a back affordance that exists on some phones is worse than none.
 */
export function backButton(label: string, onBack: () => void): HTMLButtonElement {
  const btn = button("back-btn", label, onBack);
  // Prepended, so the arrow sits before the word in both languages.
  btn.insertAdjacentHTML("afterbegin", svgWrap(BACK_ARROW));
  return btn;
}

export function backBar(label: string, onBack: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "backbar";
  row.append(backButton(label, onBack));
  return row;
}

export type OutcomeAction = {
  label: string;
  onClick: () => void;
  primary?: boolean;
};

/**
 * The centred "here is what happened" screen: a result, a cooldown, a
 * misconfiguration. Same shape as renderStatus, but parameterised by copy the
 * caller owns rather than by a StatusKey, and it can carry more than one
 * action — a passed quiz has two next moves and a cooldown has one.
 */
export function renderOutcome(opts: {
  tone: Tone;
  paths: string;
  title: string;
  body: string;
  /** Between the body and the actions: the score line, the topic card. */
  extra?: HTMLElement[];
  actions: OutcomeAction[];
  onRepaint: () => void;
}): void {
  const view = beginScreen("screen--center", opts.onRepaint);
  view.append(glyphBox(opts.tone, opts.paths));
  view.append(text("h1", "status-title", opts.title));
  view.append(text("p", "status-body", opts.body));
  for (const node of opts.extra ?? []) view.append(node);
  for (const action of opts.actions) {
    view.append(
      button(
        action.primary ? "btn-primary" : "btn-ghost",
        action.label,
        action.onClick
      )
    );
  }
  endScreen();
}

export function renderLoading(): void {
  repaint = null;
  // Restart the CSS reveal of the slow-network line.
  //
  // That line is revealed by an `animation-delay` in style.css rather than a
  // timer here, because on a cold start main.ts is queued behind the deferred
  // telegram.org fetch and may not run for the length of a network timeout --
  // a JS timer would never start and the skeleton would shimmer in silence.
  // The animation uses `forwards`, so once it has run the hint stays visible;
  // without this restart a RETRY would land on the loading screen with "the
  // connection is slow" already showing, before anything is slow.
  //
  // Reaching this line at all means the bundle is alive, so relying on JS for
  // the restart is safe in a way that relying on it for the first reveal is
  // not.
  const hint = el("loading-hint");
  hint.style.animation = "none";
  void hint.offsetWidth; // forced reflow: without it the restart is coalesced away
  hint.style.animation = "";
  show("loading");
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
  paintLang = paint;
  panel.addEventListener("click", (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-lang]");
    const next = btn?.dataset["lang"];
    if (next !== "ru" && next !== "uz") return;
    if (next === lang()) return;
    setLang(next as Lang, true);
    paintLang?.();
    // The loading hint needs no repaint here: setLang stamps <html lang>, and
    // the [lang] rules in style.css swap the two static spans.
    repaint?.();
  });
  paint();
}
