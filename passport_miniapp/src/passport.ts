// The trainee's own passport — the screen this product is judged by (Task C2).
//
// It renders exactly what GET /api/passport/tg/me returns and nothing it does
// not: there is no name, no photo and no branch name anywhere in that payload
// (terminal_id is a bare uuid), so the screen never greets anybody by name.
//
// Four things, top to bottom, and each answers one question a cook standing in
// a kitchen actually asks:
//   ring    — how far am I?
//   strip   — how much time is left?
//   modules — what exactly is left, and what can I do RIGHT NOW?
//   stamps  — what did I already earn?
import {
  fmtDate,
  lang,
  parseTs,
  t,
  type StampType,
} from "./i18n";
import { beginScreen, endScreen, svgWrap, text } from "./ui";

// ---------------------------------------------------------------------------
// The payload, typed from tg-controller.ts's /passport/tg/me handler.
// ---------------------------------------------------------------------------

export type Topic = {
  id: string;
  sort: number;
  title_ru: string;
  title_uz: string;
  // The TWI material. /me already carries it for every topic in the programme,
  // so the topic screen (C3) needs no second request — which is the difference
  // between a card that paints instantly and one that waits on branch wifi.
  // Every one of these columns is `.default("")`, so "" means "HR left it
  // blank", not "missing field".
  step_ru: string;
  step_uz: string;
  key_point_ru: string;
  key_point_uz: string;
  reason_ru: string;
  reason_uz: string;
  /** -> passport_media. Nothing serves those bytes yet; see TopicDict.video_note. */
  video_id: string | null;
  has_quiz: boolean;
  has_observation: boolean;
};

export type TopicRow = { topic: Topic; level: number };

export type ModuleRow = {
  module: { id: string; title_ru: string; title_uz: string; brand: string | null };
  required: boolean;
  deadline_at: string | null;
  deadline_status: "ok" | "warning" | "overdue";
  topics: TopicRow[];
};

export type Me = {
  enrollment: { id: string; started_at: string; probation_deadline: string | null };
  program: { title_ru: string; title_uz: string } | null;
  modules: ModuleRow[];
  stamps: {
    id: string;
    type: StampType;
    module_id: string | null;
    issued_at: string;
    valid_until: string | null;
  }[];
};

/**
 * Shallow shape check, not a schema validator. The point is only to refuse a
 * body that would throw halfway through rendering (a proxy's HTML error page
 * parsed as JSON, a future backend that renames a field) and let main.ts show
 * an honest error screen instead of a half-drawn passport.
 */
export function parseMe(data: unknown): Me | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const enrollment = d["enrollment"];
  if (!enrollment || typeof enrollment !== "object") return null;
  if (!Array.isArray(d["modules"]) || !Array.isArray(d["stamps"])) return null;
  return data as Me;
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

/** «Сам» is the bar — the admin matrix says so in as many words. */
export const BAR = 3;

/** Same 3 days the backend uses for `deadline_status: "warning"`. */
const WARNING_MS = 3 * 86400_000;

const DAY_MS = 86400_000;

/**
 * The highest level this topic can reach WITHOUT a mentor in the room, derived
 * from state.ts:
 *   quiz only              → quiz passed gives 3
 *   quiz + observation     → quiz passed gives 2, the rest is the mentor's move
 *   observation only       → opening the material gives 1
 *
 * This is what the lock is measured against, and the reason it is measured
 * against this and not against «Сам»: gate the next topic on level 3 and a
 * single absent mentor freezes the whole passport, since almost every topic
 * ships with verification_type = quiz_observation.
 */
function soloCeiling(topic: Topic): number {
  if (!topic.has_quiz) return 1;
  return topic.has_observation ? 2 : BAR;
}

/**
 * HONEST NOTE, and it belongs in the code and not only in the report: the
 * backend does NOT enforce this order. loadTopicInEnrollment checks that the
 * topic is active, published and inside this enrollment's program — nothing
 * more — and quiz start only looks at the topic's own level. So the lock below
 * is a guide through the material, not a wall: it is honest about sequence but
 * it is not a security boundary, and the copy («Откроется позже») never claims
 * to be one.
 *
 * SETTLED, so nobody picks this up as an open TODO: there is no matching
 * server-side gate and none is wanted. The spec files «квиз до материала» among
 * the anomaly detector's signals, i.e. an out-of-order pass is to be FLAGGED,
 * not refused; the endpoint contract has no ordering rule; and the lock is weak
 * by construction anyway (soloCeiling — open the material and everything after
 * it is formally reachable). C3 owns /topics/:id/opened and the quiz routes and
 * deliberately added no gate. Making the order a rule is a separate, conscious
 * backend decision, not a leftover.
 */
type Row = TopicRow & { locked: boolean; current: boolean };

function rowsOf(topics: TopicRow[]): Row[] {
  let blocked = false;
  const rows: Row[] = [];
  for (const item of topics) {
    // A topic that has ALREADY been reached is never locked, whatever came
    // before it. Levels are not monotonic in practice: a mentor can sign off
    // topic 3 before topic 2's quiz is passed, and HR can reorder `sort` after
    // progress exists. Inheriting the lock unconditionally then drew a green
    // check and «Откроется позже» on one row, while ringCard and isDone kept
    // counting it done — a module reading «Сдано» with a locked topic inside.
    const short = item.level < soloCeiling(item.topic);
    const locked = blocked && short;
    if (short) blocked = true;
    rows.push({ ...item, locked, current: false });
  }
  return rows;
}

/** Done = every active topic at «Сам» or above. A module with no topics is not done. */
function isDone(rows: Row[]): boolean {
  return rows.length > 0 && rows.every((r) => r.level >= BAR);
}

/**
 * Two functions, not one, because the two sides round in opposite directions
 * and rounding either of them the other way produces a sentence that is wrong
 * for a whole day:
 *   ahead — ceil, so half a day left reads «осталось 1 день», not «0».
 *   behind — floor, so an hour past the deadline is 0 and the caller says
 *            «срок вышел» instead of «просрочено на 0 дней», which is what a
 *            naive abs(ceil()) printed for the entire first day of every
 *            overdue module — the most common overdue moment there is.
 */
function daysLeft(ms: number, now: number): number {
  return Math.ceil((ms - now) / DAY_MS);
}

function daysOver(ms: number, now: number): number {
  return Math.floor((now - ms) / DAY_MS);
}

/**
 * Calendar-day equality, deliberately not "less than 24 hours": a deadline at
 * 18:00 today is «срок сегодня» at 09:00 and «осталось 1 день» is a lie about
 * it, while a deadline at 09:00 tomorrow is genuinely a day away even though
 * it is 15 hours off. daysLeft() alone can never produce 0 — it rounds up —
 * so without this the string was dead code.
 */
function sameDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

/** «просрочено на 3 дня», or «срок вышел» while it is still the same day. */
function overText(ms: number, now: number): string {
  const days = daysOver(ms, now);
  return days >= 1 ? t().p.over(days) : t().p.over_today;
}

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

const GLYPH = {
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  chevron: '<path d="M8 10l4 4 4-4"/>',
  seal: '<circle cx="12" cy="10" r="6"/><path d="M8.5 15.5 7 22l5-2.4L17 22l-1.5-6.5"/>',
  passport:
    '<rect x="5" y="3.5" width="14" height="17" rx="2.5"/><path d="M9 3.5v17"/><path d="M12.5 9.5h3.5M12.5 13h3.5"/>',
} as const;

/** Uzbek columns are `.default("")` in the schema: fall back, never render blank. */
export function local(ru: string, uz: string): string {
  return lang() === "uz" && uz.trim() ? uz : ru;
}

function span(cls: string, value: string): HTMLElement {
  return text("span", cls, value);
}

function chip(cls: string, value: string): HTMLElement {
  return span(`chip ${cls}`, value);
}

function glyphSpan(cls: string, paths: string): HTMLElement {
  const node = document.createElement("span");
  node.className = cls;
  node.innerHTML = svgWrap(paths);
  return node;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function head(me: Me): HTMLElement {
  const d = t();
  const node = document.createElement("header");
  node.className = "pp-head";
  const title = me.program
    ? local(me.program.title_ru, me.program.title_uz)
    : d.passport_title;
  node.append(text("h1", "pp-title", title));
  const started = fmtDate(me.enrollment.started_at);
  if (started) node.append(span("pp-sub", d.p.since(started)));
  return node;
}

/**
 * The ring counts TOPICS at «Сам» inside REQUIRED modules only. Optional
 * modules stay in the list and are labelled, but putting them in the
 * denominator would make the trainee's percentage disagree with every reading
 * a manager takes off the matrix. 0/0 renders no ring at all rather than a
 * meaningless 0 %.
 */
function ringCard(mods: { row: ModuleRow; rows: Row[] }[]): HTMLElement | null {
  const d = t();
  let done = 0;
  let total = 0;
  for (const m of mods) {
    if (!m.row.required) continue;
    for (const r of m.rows) {
      total += 1;
      if (r.level >= BAR) done += 1;
    }
  }
  if (total === 0) return null;

  const pct = Math.round((done / total) * 100);
  const card = document.createElement("section");
  card.className = "ring-card";

  const ring = document.createElement("div");
  ring.className = "ring";
  ring.setAttribute("role", "img");
  ring.setAttribute("aria-label", `${d.p.ring_counts(done, total)} ${d.p.ring_caption}`);
  // 2πr for r = 42.
  const circumference = 263.9;
  ring.innerHTML =
    '<svg viewBox="0 0 100 100" aria-hidden="true">' +
    '<circle class="ring-track" cx="50" cy="50" r="42"/>' +
    `<circle class="ring-fill" cx="50" cy="50" r="42" stroke-dasharray="${circumference}" ` +
    `stroke-dashoffset="${(circumference * (100 - pct)) / 100}"/>` +
    "</svg>";
  ring.append(span("ring-pct", `${pct}%`));

  const side = document.createElement("div");
  side.className = "ring-side";
  side.append(span("ring-count", d.p.ring_counts(done, total)));
  side.append(span("ring-caption", d.p.ring_caption));

  card.append(ring, side);
  return card;
}

/**
 * The deadline strip is the PROBATION period — the one date that decides
 * whether this person keeps the job — drawn as elapsed time, not as remaining
 * time, so it reads the way a shift does: the bar fills as the clock runs out.
 * Three states, and each says a different sentence, never just a different
 * colour:
 *   ok       green   «до 20 сен»
 *   warning  amber   «осталось 2 дня»      (the backend's own 3-day threshold)
 *   overdue  red     «просрочено на 3 дня»
 * No probation_deadline (the column is nullable) → no strip.
 */
function strip(me: Me, now: number): HTMLElement | null {
  const d = t();
  const due = parseTs(me.enrollment.probation_deadline);
  if (due === null) return null;
  const started = parseTs(me.enrollment.started_at);

  const left = daysLeft(due, now);
  const state = now > due ? "over" : due - now <= WARNING_MS ? "warn" : "ok";
  const value =
    state === "over"
      ? overText(due, now)
      : sameDay(due, now)
        ? d.p.due_today
        : state === "warn"
          ? d.p.left(left)
          : d.p.until(fmtDate(me.enrollment.probation_deadline));

  const node = document.createElement("section");
  node.className = "strip";
  node.dataset["state"] = state;

  const row = document.createElement("div");
  row.className = "strip-head";
  row.append(span("strip-label", d.p.probation));
  row.append(span("strip-value", value));
  node.append(row);

  const bar = document.createElement("div");
  bar.className = "strip-bar";
  const fill = document.createElement("i");
  const ratio =
    started !== null && due > started
      ? Math.min(1, Math.max(0, (now - started) / (due - started)))
      : state === "over"
        ? 1
        : 0;
  fill.style.width = `${Math.round(ratio * 100)}%`;
  bar.append(fill);
  node.append(bar);
  return node;
}

/**
 * `deadline_status: "ok"` means BOTH "you have time" and "this module has no
 * deadline at all" — deadlineStatus() returns ok with deadline_at: null when
 * deadline_days is null. The discriminator is deadline_at, so a module without
 * a deadline gets no chip rather than a green one that would promise a date
 * nobody set.
 *
 * The other honest complication is carried over from the admin matrix: a module
 * the trainee has ALREADY finished still comes back "overdue" once its date has
 * passed. Solid red there would send someone chasing work that is done, so it
 * gets the dashed «Сдано с опозданием» chip instead — and it is excluded from
 * the overdue counter, exactly as the admin excludes it from totals.
 */
function deadlineChip(row: ModuleRow, done: boolean, now: number): HTMLElement | null {
  const d = t();
  const at = parseTs(row.deadline_at);
  if (at === null) return null;
  if (done) {
    return row.deadline_status === "overdue"
      ? chip("chip--late", d.p.done_late)
      : chip("chip--done", d.p.done);
  }
  const left = daysLeft(at, now);
  if (row.deadline_status === "overdue") return chip("chip--over", overText(at, now));
  if (row.deadline_status === "warning") {
    return chip("chip--warn", sameDay(at, now) ? d.p.due_today : d.p.left(left));
  }
  return chip("chip--calm", d.p.until(fmtDate(row.deadline_at)));
}

function topicRow(
  r: Row,
  index: number,
  onOpenTopic?: (topicId: string) => void
): HTMLElement {
  const d = t();
  const li = document.createElement("li");
  li.className = "tp";
  const state = r.locked ? "locked" : r.level >= BAR ? "done" : r.current ? "current" : "open";
  li.dataset["state"] = state;

  // A button ONLY when something is wired to it. C3 owns the topic screen; until
  // it passes a handler there is no dead tap target pretending to be one.
  const inner = document.createElement(onOpenTopic && !r.locked ? "button" : "div");
  inner.className = "tp-inner";
  if (inner instanceof HTMLButtonElement) {
    inner.type = "button";
    inner.addEventListener("click", () => onOpenTopic?.(r.topic.id));
  }

  const node = document.createElement("span");
  node.className = "tp-node";
  node.dataset["l"] = String(r.level);
  if (r.level >= BAR) node.innerHTML = svgWrap(GLYPH.check);
  else if (r.locked) node.innerHTML = svgWrap(GLYPH.lock);
  // The position in THIS list, not topic.sort. `sort` is an ordering key, and
  // the trainee's list is filtered to active topics: retire topic 2 and the
  // remaining sort values read 1, 3, 4. The admin's own numbering counts
  // inactive rows too, so `sort + 1` would not even match what HR sees.
  else node.textContent = String(index + 1);
  inner.append(node);

  const body = document.createElement("span");
  body.className = "tp-body";
  body.append(span("tp-title", local(r.topic.title_ru, r.topic.title_uz)));
  // Level 2 with an observation is the one state where the trainee is not the
  // one who is stuck: the quiz is behind them and the next move is the mentor's.
  // Saying so costs one muted line and saves a shift of waiting in silence.
  if (!r.locked && r.level === 2 && r.topic.has_observation) {
    body.append(span("tp-hint", d.p.need_mentor));
  } else if (r.current && r.level > 0) {
    // «Ваш шаг» in words above level 0, where the chip has been taken over by
    // the level name.
    //
    // At level 0 the chip itself still says it and there is nothing to add. The
    // moment C3's /topics/:id/opened raises the row to 1, the chip becomes
    // «Увидел» and the only thing left marking THE row was the node's accent
    // ring — a colour, alone. That breaks in the ordinary case, not an exotic
    // one: the lock in rowsOf is computed per module, so two parallel branches
    // of a programme (kitchen and service) leave two rows reading «Увидел» at
    // once, identical letter for letter, distinguishable only by ring colour —
    // on a cheap screen, in a kitchen, by someone returning after a shift.
    // Whatever carries meaning on this screen carries it twice.
    //
    // `else if`, and it never actually competes: need_mentor needs
    // level === 2 && has_observation, which makes soloCeiling 2, which makes
    // `level < soloCeiling` false — so a row wearing that hint is never the
    // current one.
    body.append(span("tp-hint tp-hint--now", d.p.current));
  }
  inner.append(body);

  const label = r.locked
    ? d.p.locked
    : r.current && r.level === 0
      ? d.p.current
      : (d.p.level[Math.min(4, Math.max(0, r.level))] ?? "");
  const tag = span("tp-chip", label);
  tag.dataset["l"] = String(r.level);
  inner.append(tag);

  li.append(inner);
  return li;
}

function moduleCard(
  m: { row: ModuleRow; rows: Row[] },
  open: boolean,
  index: number,
  now: number,
  toggle: (id: string) => void,
  onOpenTopic?: (topicId: string) => void
): HTMLElement {
  const d = t();
  const done = isDone(m.rows);
  const card = document.createElement("section");
  card.className = "mod";
  card.dataset["open"] = open ? "1" : "0";

  // A module with no topics has nothing to unfold, so its header is a header
  // and not a button that swallows a tap and answers with nothing.
  const foldable = m.rows.length > 0;
  const btn = document.createElement(foldable ? "button" : "div");
  btn.className = "mod-btn";
  if (btn instanceof HTMLButtonElement) {
    btn.type = "button";
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.addEventListener("click", () => toggle(m.row.module.id));
  }

  const idx = document.createElement("span");
  idx.className = "mod-idx";
  idx.dataset["done"] = done ? "1" : "0";
  if (done) idx.innerHTML = svgWrap(GLYPH.check);
  else idx.textContent = String(index + 1);
  btn.append(idx);

  const main = document.createElement("span");
  main.className = "mod-main";
  main.append(span("mod-title", local(m.row.module.title_ru, m.row.module.title_uz)));

  const meta = document.createElement("span");
  meta.className = "mod-meta";
  const dl = deadlineChip(m.row, done, now);
  if (dl) meta.append(dl);
  if (!m.row.required) meta.append(chip("chip--calm", d.p.optional));
  if (m.row.module.brand) meta.append(chip("chip--brand", m.row.module.brand));
  if (meta.childElementCount) main.append(meta);

  if (m.rows.length) {
    const bar = document.createElement("span");
    bar.className = "mod-bar";
    const fill = document.createElement("i");
    const at = m.rows.filter((r) => r.level >= BAR).length;
    fill.style.width = `${Math.round((at / m.rows.length) * 100)}%`;
    bar.append(fill);
    main.append(bar);
    main.append(span("mod-count", d.p.topics_progress(at, m.rows.length)));
  } else {
    // Not level 0: there is nothing to have done. The admin matrix makes the
    // same distinction and leaves such a cell empty rather than colouring it.
    main.append(span("mod-count", d.p.no_topics));
  }
  btn.append(main);
  if (foldable) btn.append(glyphSpan("mod-chev", GLYPH.chevron));
  card.append(btn);

  if (open && m.rows.length) {
    const list = document.createElement("ul");
    list.className = "topics";
    m.rows.forEach((r, i) => list.append(topicRow(r, i, onOpenTopic)));
    card.append(list);
  }
  return card;
}

function stampsSection(me: Me): HTMLElement {
  const d = t();
  const wrap = document.createElement("section");
  wrap.className = "pp-block";
  wrap.append(text("h2", "sec-title", d.p.stamps));

  if (!me.stamps.length) {
    wrap.append(span("empty-note", d.p.stamps_empty));
    return wrap;
  }

  const titles = new Map(
    me.modules.map((m) => [m.module.id, local(m.module.title_ru, m.module.title_uz)])
  );
  const list = document.createElement("div");
  list.className = "stamps";
  for (const s of me.stamps) {
    const item = document.createElement("div");
    item.className = "stamp";
    item.append(glyphSpan("stamp-glyph", GLYPH.seal));
    const body = document.createElement("span");
    body.className = "stamp-body";
    const named = s.type === "module_cert" ? titles.get(s.module_id ?? "") : null;
    // A stamp type this build has never heard of still says something: the
    // enum is extended server-side (universal_* arrived in stage 2's plan) and
    // an unknown one rendered a seal, a date and a blank line.
    body.append(span("stamp-title", named ?? d.p.stamp[s.type] ?? d.p.stamp_other));
    const sub = [fmtDate(s.issued_at)];
    if (s.valid_until) sub.push(d.p.stamp_valid(fmtDate(s.valid_until)));
    body.append(span("stamp-sub", sub.filter(Boolean).join(" · ")));
    item.append(body);
    list.append(item);
  }
  wrap.append(list);
  return wrap;
}

/**
 * Enrollment open, program published nothing yet. Reachable today: /me answers
 * 200 with modules: [] whenever the program's modules are still draft or have
 * been deactivated. It is NOT `not_started` (that one means there is no
 * enrollment at all), and it must not be a skeleton that never resolves.
 */
function emptyProgram(me: Me): HTMLElement {
  const d = t();
  const view = beginScreen("screen--center", () => renderPassport(me));
  view.append(glyphSpan("glyph glyph--neutral", GLYPH.passport));
  view.append(text("h1", "status-title", d.p.empty_title));
  view.append(text("p", "status-body", d.p.empty_body));
  return view;
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

/**
 * Which modules are unfolded. Kept outside the render so that switching the
 * language — which repaints the whole screen — does not fold a trainee's
 * module back up under their finger.
 */
const expanded = new Set<string>();
let expandedFor: string | null = null;

export function renderPassport(me: Me, onOpenTopic?: (topicId: string) => void): void {
  const now = Date.now();
  const d = t();

  const mods = me.modules.map((row) => ({ row, rows: rowsOf(row.topics) }));

  if (!mods.length) {
    emptyProgram(me);
    endScreen();
    return;
  }

  // The single «Ваш шаг» marker: the first topic anywhere in the programme that
  // is unlocked and still below what the trainee can reach on their own. One
  // marker, so the screen answers "what now?" without competing for attention.
  let marked = false;
  for (const m of mods) {
    for (const r of m.rows) {
      if (marked || r.locked || r.level >= soloCeiling(r.topic)) continue;
      r.current = true;
      marked = true;
      // First run for this enrollment: unfold the module the trainee is in.
      if (expandedFor !== me.enrollment.id) expanded.add(m.row.module.id);
    }
  }
  if (expandedFor !== me.enrollment.id) {
    if (!marked && mods[0]) expanded.add(mods[0].row.module.id);
    expandedFor = me.enrollment.id;
  }

  const view = beginScreen("screen--top", () => renderPassport(me, onOpenTopic));
  view.append(head(me));

  const ring = ringCard(mods);
  if (ring) view.append(ring);

  const bar = strip(me, now);
  if (bar) view.append(bar);

  // Counted the way the admin counts it: what still needs chasing. A module
  // that is finished is not chased, however late it was.
  const overdue = mods.filter(
    (m) => m.row.deadline_at && m.row.deadline_status === "overdue" && !isDone(m.rows)
  ).length;
  if (overdue) view.append(span("overdue-note", d.p.overdue_modules(overdue)));

  const block = document.createElement("section");
  block.className = "pp-block";
  block.append(text("h2", "sec-title", d.p.modules));
  const toggle = (id: string): void => {
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    renderPassport(me, onOpenTopic);
  };
  mods.forEach((m, i) => {
    block.append(
      moduleCard(m, expanded.has(m.row.module.id), i, now, toggle, onOpenTopic)
    );
  });
  view.append(block);

  view.append(stampsSection(me));
  endScreen();
}
