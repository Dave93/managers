// The mentor's two screens (Task C4).
//
// A branch manager opens the SAME miniapp as their trainees and gets a
// different app: not a passport but a queue of people. The question this
// screen answers is deliberately narrow — WHO is standing still waiting for
// me, and who runs out of time first — because that is the only question a
// manager can act on between two orders.
//
// What it does NOT do, and says so out loud in two places: it does not sign.
// The signature stays in the office admin until stage 2's QR handshake exists.
// A "sign" button here would be one person with two thumbs certifying a whole
// branch — exactly the fraud the two-actor split is built to stop. The screen
// explains the rule rather than hiding a missing button, because a mentor who
// cannot find the button assumes the app is broken and stops using it.
import { api } from "./api";
import { fmtDate, parseTs, t } from "./i18n";
import { BAR, WARNING_MS, deadlineLabel, local } from "./passport";
import {
  backBar,
  beginScreen,
  button,
  endScreen,
  glyphBox,
  renderLoading,
  renderStatus,
  svgWrap,
  text,
} from "./ui";

// ---------------------------------------------------------------------------
// The payloads, typed from tg-controller.ts's two mentor handlers.
// ---------------------------------------------------------------------------

type DeadlineState = "ok" | "warning" | "overdue";

export type QueueTopic = {
  topic_id: string;
  title_ru: string;
  title_uz: string;
  module_id: string;
  module_title_ru: string;
  module_title_uz: string;
  verification_type: string;
  level: number;
  deadline_at: string | null;
  deadline_status: DeadlineState;
};

export type QueueItem = {
  enrollment_id: string;
  enrollment_status: string;
  started_at: string;
  probation_deadline: string | null;
  employee: {
    id: string;
    first_name: string;
    last_name: string;
    position: string | null;
  };
  terminal: { id: string; name: string | null };
  program: { title_ru: string; title_uz: string };
  waiting_count: number;
  deadline_at: string | null;
  deadline_status: DeadlineState;
  topics: QueueTopic[];
};

export type Queue = {
  scope: { is_hq: boolean; terminal_count: number };
  total: number;
  items: QueueItem[];
};

export type CardTopic = {
  id: string;
  title_ru: string;
  title_uz: string;
  verification_type: string;
  level: number;
  awaiting_observation: boolean;
  /** False for `dual` and photo topics: the office sign-off refuses both. */
  signable: boolean;
  observed_at: string | null;
};

export type CardModule = {
  module: { id: string; title_ru: string; title_uz: string; brand: string | null };
  required: boolean;
  deadline_at: string | null;
  deadline_status: DeadlineState;
  topics: CardTopic[];
};

export type Card = {
  enrollment: {
    id: string;
    status: string;
    started_at: string;
    probation_deadline: string | null;
  };
  employee: {
    id: string;
    first_name: string;
    last_name: string;
    position: string | null;
  };
  terminal: { id: string; name: string | null };
  program: { title_ru: string; title_uz: string };
  modules: CardModule[];
};

/** Same shallow contract check as parseMe: refuse a body that would throw. */
function parseQueue(data: unknown): Queue | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d["items"]) || typeof d["total"] !== "number") return null;
  if (!d["scope"] || typeof d["scope"] !== "object") return null;
  return data as Queue;
}

function parseCard(data: unknown): Card | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d["modules"])) return null;
  if (!d["enrollment"] || typeof d["enrollment"] !== "object") return null;
  if (!d["employee"] || typeof d["employee"] !== "object") return null;
  return data as Card;
}

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

const GLYPH = {
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  calm: '<path d="M5 12.5 10 17.5 19 7"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  office:
    '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8 9h4M8 13h8M8 17h6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
} as const;

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

/**
 * Two letters, and a fallback that is never blank: employees.first_name and
 * last_name are NOT NULL in the schema but arrive as "" through the left join
 * if the row is gone, and an empty disc reads as a rendering bug.
 */
function initials(first: string, last: string): string {
  const a = last.trim()[0] ?? "";
  const b = first.trim()[0] ?? "";
  const both = (a + b).toUpperCase();
  return both || "?";
}

function fullName(e: { first_name: string; last_name: string }): string {
  const name = `${e.last_name} ${e.first_name}`.trim();
  return name || t().m.no_name;
}

/**
 * The person's meta line: what they do and where. Both halves are optional in
 * the data (position is nullable, terminal_name comes through a left join), so
 * the separator is joined rather than concatenated — otherwise a missing
 * branch leaves a dangling « · ».
 */
function metaLine(item: {
  employee: { position: string | null };
  terminal: { name: string | null };
}): string {
  return [item.employee.position, item.terminal.name]
    .filter((v): v is string => !!v && v.trim().length > 0)
    .join(" · ");
}

/**
 * The urgency chip, built from the SAME rounding rules the trainee sees on
 * their own phone (deadlineLabel lives in passport.ts and is shared, not
 * copied): a module that reads «просрочено на 17 дней» there cannot read
 * anything else here.
 *
 * A module with no deadline gets a quiet «без срока» rather than no chip at
 * all — on this screen the absence is information, since it is exactly why
 * that person sits at the bottom of the list.
 */
function urgencyChip(at: string | null, status: DeadlineState, now: number): HTMLElement {
  const ms = parseTs(at);
  if (ms === null) return chip("chip--calm", t().m.no_deadline);
  const label = deadlineLabel(ms, status, now);
  return chip(label.cls, label.text);
}

/** ok | warning | overdue | none — drives one quiet colour cue on the disc. */
function urgencyOf(item: QueueItem): string {
  return item.deadline_at === null ? "none" : item.deadline_status;
}

// ---------------------------------------------------------------------------
// The note. It appears twice on purpose.
// ---------------------------------------------------------------------------

/**
 * Where the signature happens, and why it is not here.
 *
 * `short` is the version under the queue header — read once, on the way in.
 * The full version sits on the trainee card directly beneath the topics that
 * are waiting, which is the exact moment somebody looks for a button to press.
 * Both are built from the same two strings so the two screens cannot drift
 * into telling a manager two different things about where to sign.
 */
function signoffNote(short: boolean): HTMLElement {
  const d = t();
  const node = document.createElement("section");
  node.className = short ? "m-note m-note--slim" : "m-note";
  node.append(glyphSpan("m-note-glyph", GLYPH.office));
  const body = document.createElement("span");
  body.className = "m-note-body";
  body.append(span("m-note-title", d.mentor_signoff_note));
  if (!short) body.append(span("m-note-why", d.m.signoff_why));
  node.append(body);
  return node;
}

// ---------------------------------------------------------------------------
// Screen 1 — the queue
// ---------------------------------------------------------------------------

function queueHead(q: Queue): HTMLElement {
  const d = t();
  const node = document.createElement("header");
  node.className = "pp-head";
  node.append(text("h1", "pp-title", d.mentor_title));
  node.append(
    span(
      "pp-sub",
      q.scope.is_hq ? d.m.scope_hq : d.m.scope_branches(q.scope.terminal_count)
    )
  );
  return node;
}

function personRow(
  item: QueueItem,
  now: number,
  onOpen: (enrollmentId: string) => void
): HTMLElement {
  const d = t();
  const row = button("qp", "", () => onOpen(item.enrollment_id));
  // button() sets textContent; this screen builds its own children instead.
  row.textContent = "";
  row.dataset["urgency"] = urgencyOf(item);

  row.append(span("qp-ava", initials(item.employee.first_name, item.employee.last_name)));

  const body = document.createElement("span");
  body.className = "qp-body";

  const top = document.createElement("span");
  top.className = "qp-top";
  top.append(span("qp-name", fullName(item.employee)));
  // Only when it adds something: one waiting topic is already spelled out on
  // the line below, and a badge reading "1" next to it is noise.
  if (item.waiting_count > 1) {
    top.append(span("qp-n", String(item.waiting_count)));
  }
  body.append(top);

  const meta = metaLine(item);
  if (meta) body.append(span("qp-meta", meta));

  const chips = document.createElement("span");
  chips.className = "qp-chips";
  chips.append(urgencyChip(item.deadline_at, item.deadline_status, now));
  // A paused traineeship is still signable (the office sign-off accepts it),
  // but the mentor should know before walking over that this person is on a
  // break — otherwise the queue sends them to look for somebody who is not on
  // shift this week.
  if (item.enrollment_status === "paused") {
    chips.append(chip("chip--calm", d.m.paused));
  }
  body.append(chips);

  // What exactly is waiting, in the mentor's own words. Two titles, then a
  // count: three lines of topic names would push the next person off the
  // screen, and the card one tap away carries the full list.
  const titles = item.topics.map((tp) => local(tp.title_ru, tp.title_uz));
  const shown = titles.slice(0, 2).join(", ");
  const rest = titles.length - 2;
  body.append(span("qp-topics", rest > 0 ? `${shown} ${d.m.more(rest)}` : shown));

  row.append(body);
  row.append(glyphSpan("qp-chev", GLYPH.chevron));
  return row;
}

function queueEmpty(q: Queue, reload: () => void): void {
  const d = t();
  const view = beginScreen("screen--center", () => renderQueue(q, reload));
  view.append(glyphBox("good", GLYPH.calm));
  view.append(text("h1", "status-title", d.m.empty_title));
  view.append(
    text(
      "p",
      "status-body",
      // A manager with no branches at all is not looking at an empty queue —
      // they are looking at an account nobody has bound to a branch yet, and
      // "nobody is waiting" would send them back to the floor to wait for a
      // notification that can never arrive.
      !q.scope.is_hq && q.scope.terminal_count === 0
        ? d.m.empty_no_branch
        : d.m.empty_body
    )
  );
  view.append(button("btn-ghost", d.retry, reload));
  view.append(signoffNote(false));
  endScreen();
}

export function renderQueue(q: Queue, reload: () => void, onOpen?: (id: string) => void): void {
  const d = t();
  const now = Date.now();
  if (!q.items.length) {
    queueEmpty(q, reload);
    return;
  }

  const view = beginScreen("screen--top", () => renderQueue(q, reload, onOpen));
  view.append(queueHead(q));
  view.append(signoffNote(true));

  const block = document.createElement("section");
  block.className = "pp-block";
  const head = document.createElement("div");
  head.className = "m-sec";
  head.append(text("h2", "sec-title", d.m.waiting_title));
  head.append(span("m-sec-n", String(q.total)));
  block.append(head);

  const list = document.createElement("div");
  list.className = "qp-list";
  for (const item of q.items) list.append(personRow(item, now, onOpen ?? (() => {})));
  block.append(list);

  // Only when the server actually truncated. `total` is counted before the
  // cap, so this is the one honest way to say "there are more" — and it is
  // reachable only for an HQ account, which is precisely who would otherwise
  // read the first hundred as the whole company.
  if (q.total > q.items.length) {
    block.append(span("empty-note", d.m.capped(q.items.length, q.total)));
  }
  view.append(block);
  view.append(button("btn-ghost", d.retry, reload));
  endScreen();
}

// ---------------------------------------------------------------------------
// Screen 2 — one trainee's card
// ---------------------------------------------------------------------------

function cardHead(card: Card): HTMLElement {
  const node = document.createElement("header");
  node.className = "pp-head m-head";
  node.append(span("m-ava", initials(card.employee.first_name, card.employee.last_name)));
  const body = document.createElement("div");
  body.className = "m-head-body";
  body.append(text("h1", "pp-title", fullName(card.employee)));
  const meta = metaLine(card);
  if (meta) body.append(span("pp-sub", meta));
  const program = local(card.program.title_ru, card.program.title_uz);
  const started = fmtDate(card.enrollment.started_at);
  // NOT p.since: that string is «Стажировка с 23 июл», and next to a
  // programme literally named «Кассир — стажировка» it printed the same word
  // twice in one line. The mentor's version is the date alone.
  const line = [program, started ? t().m.since(started) : ""]
    .filter(Boolean)
    .join(" · ");
  if (line) body.append(span("pp-sub", line));
  node.append(body);
  return node;
}

/**
 * How far along this person is, counted EXACTLY as the trainee's own ring
 * counts it — topics at «Сам» inside required modules — so the mentor and the
 * trainee are reading the same number. Drawn as a bar rather than the ring:
 * the mentor is comparing people, not celebrating one.
 */
function progressBlock(card: Card): HTMLElement | null {
  const d = t();
  let done = 0;
  let total = 0;
  for (const m of card.modules) {
    if (!m.required) continue;
    for (const tp of m.topics) {
      total += 1;
      if (tp.level >= BAR) done += 1;
    }
  }
  if (total === 0) return null;

  const node = document.createElement("section");
  node.className = "m-prog";
  const head = document.createElement("div");
  head.className = "m-prog-head";
  head.append(span("m-prog-label", d.m.progress_label));
  head.append(span("m-prog-count", d.p.ring_counts(done, total)));
  node.append(head);
  const bar = document.createElement("div");
  bar.className = "m-prog-bar";
  const fill = document.createElement("i");
  fill.style.width = `${Math.round((done / total) * 100)}%`;
  bar.append(fill);
  node.append(bar);
  return node;
}

/**
 * The probation strip, reusing the trainee's own component wholesale: same
 * classes, same three states, same copy. It is the one date that decides
 * whether this person keeps the job, and a mentor deciding whether to make
 * time for an observation today is exactly who needs it.
 */
function probationStrip(card: Card, now: number): HTMLElement | null {
  const d = t();
  const due = parseTs(card.enrollment.probation_deadline);
  if (due === null) return null;
  const started = parseTs(card.enrollment.started_at);
  // Derived ONCE, from the threshold passport.ts owns. The first version
  // spelled `3 * 86400_000` out twice, right next to deadlineLabel — which was
  // extracted precisely so this rule would have one home.
  const over = now > due;
  const state: "over" | "warn" | "ok" = over
    ? "over"
    : due - now <= WARNING_MS
      ? "warn"
      : "ok";
  const label = deadlineLabel(
    due,
    state === "over" ? "overdue" : state === "warn" ? "warning" : "ok",
    now
  );

  const node = document.createElement("section");
  node.className = "strip";
  node.dataset["state"] = state;
  const row = document.createElement("div");
  row.className = "strip-head";
  row.append(span("strip-label", d.p.probation));
  row.append(span("strip-value", label.text));
  node.append(row);
  const bar = document.createElement("div");
  bar.className = "strip-bar";
  const fill = document.createElement("i");
  const ratio =
    started !== null && due > started
      ? Math.min(1, Math.max(0, (now - started) / (due - started)))
      : over
        ? 1
        : 0;
  fill.style.width = `${Math.round(ratio * 100)}%`;
  bar.append(fill);
  node.append(bar);
  return node;
}

/** Why a topic that is ready still cannot be signed, in one line. */
function blockedReason(topic: CardTopic): string | null {
  if (topic.signable) return null;
  const d = t();
  if (topic.verification_type === "dual") return d.m.blocked_dual;
  if (topic.verification_type === "quiz_observation_photo") return d.m.blocked_photo;
  return null;
}

/**
 * The list at the top: what this visit is actually about. It repeats titles
 * that also appear in the module list below, and that is the point — a mentor
 * who has walked to the floor should not have to scan a whole programme to
 * rediscover the two topics the queue sent them for.
 */
function waitingBlock(card: Card): HTMLElement | null {
  const d = t();
  const waiting: { topic: CardTopic; module: CardModule }[] = [];
  for (const m of card.modules) {
    for (const tp of m.topics) {
      if (tp.awaiting_observation) waiting.push({ topic: tp, module: m });
    }
  }
  if (!waiting.length) return null;

  const block = document.createElement("section");
  block.className = "pp-block";
  const head = document.createElement("div");
  head.className = "m-sec";
  head.append(text("h2", "sec-title", d.m.waiting_title));
  head.append(span("m-sec-n", String(waiting.length)));
  block.append(head);

  const list = document.createElement("div");
  list.className = "m-wait";
  const now = Date.now();
  for (const w of waiting) {
    const item = document.createElement("div");
    item.className = "m-wait-row";
    item.append(glyphSpan("m-wait-glyph", GLYPH.eye));
    const body = document.createElement("span");
    body.className = "m-wait-body";
    body.append(span("m-wait-title", local(w.topic.title_ru, w.topic.title_uz)));
    body.append(
      span("m-wait-mod", local(w.module.module.title_ru, w.module.module.title_uz))
    );
    const chips = document.createElement("span");
    chips.className = "qp-chips";
    chips.append(urgencyChip(w.module.deadline_at, w.module.deadline_status, now));
    const blocked = blockedReason(w.topic);
    // The unsignable ones are NOT hidden here, unlike in the queue: the queue
    // is a work list and a topic the admin refuses does not belong on it, but
    // a person stuck behind one has to be visible to somebody or they wait
    // forever with nobody able to say why.
    if (blocked) chips.append(chip("chip--warn", blocked));
    body.append(chips);
    item.append(body);
    list.append(item);
  }
  block.append(list);
  return block;
}

function topicRow(topic: CardTopic, index: number): HTMLElement {
  const d = t();
  const li = document.createElement("li");
  li.className = "tp";
  li.dataset["state"] =
    topic.level >= BAR ? "done" : topic.awaiting_observation ? "current" : "open";

  const inner = document.createElement("div");
  inner.className = "tp-inner";

  const node = document.createElement("span");
  node.className = "tp-node";
  node.dataset["l"] = String(topic.level);
  if (topic.level >= BAR) node.innerHTML = svgWrap(GLYPH.calm);
  else node.textContent = String(index + 1);
  inner.append(node);

  const body = document.createElement("span");
  body.className = "tp-body";
  body.append(span("tp-title", local(topic.title_ru, topic.title_uz)));
  // The blocked reason is shown ONLY on a topic that is otherwise READY —
  // i.e. one that would be in the queue if the office could sign it. On a
  // topic still at level 0 it is a fact about a row nobody has reached yet,
  // and the first render put «нужна вторая подпись» on three untouched rows,
  // which reads as three problems where there are none.
  const blocked = topic.awaiting_observation ? blockedReason(topic) : null;
  if (topic.awaiting_observation) {
    body.append(
      blocked
        ? span("tp-hint", blocked)
        : span("tp-hint tp-hint--now", d.m.waits_for_you)
    );
  }
  inner.append(body);

  const tag = span("tp-chip", d.p.level[Math.min(4, Math.max(0, topic.level))] ?? "");
  tag.dataset["l"] = String(topic.level);
  inner.append(tag);

  li.append(inner);
  return li;
}

/**
 * Every module, always unfolded. The trainee's passport folds because the
 * trainee returns to it daily and cares about one module at a time; the mentor
 * opens this card once, standing next to somebody, and a fold is one more tap
 * between them and the answer.
 */
function moduleCard(m: CardModule, index: number, now: number): HTMLElement {
  const d = t();
  const card = document.createElement("section");
  card.className = "mod";
  card.dataset["open"] = "1";

  const btn = document.createElement("div");
  btn.className = "mod-btn";
  const done = m.topics.length > 0 && m.topics.every((tp) => tp.level >= BAR);

  const idx = document.createElement("span");
  idx.className = "mod-idx";
  idx.dataset["done"] = done ? "1" : "0";
  if (done) idx.innerHTML = svgWrap(GLYPH.calm);
  else idx.textContent = String(index + 1);
  btn.append(idx);

  const main = document.createElement("span");
  main.className = "mod-main";
  main.append(span("mod-title", local(m.module.title_ru, m.module.title_uz)));

  const meta = document.createElement("span");
  meta.className = "mod-meta";
  if (m.deadline_at) meta.append(urgencyChip(m.deadline_at, m.deadline_status, now));
  if (!m.required) meta.append(chip("chip--calm", d.p.optional));
  if (meta.childElementCount) main.append(meta);

  if (m.topics.length) {
    const bar = document.createElement("span");
    bar.className = "mod-bar";
    const fill = document.createElement("i");
    const at = m.topics.filter((tp) => tp.level >= BAR).length;
    fill.style.width = `${Math.round((at / m.topics.length) * 100)}%`;
    bar.append(fill);
    main.append(bar);
    main.append(span("mod-count", d.p.topics_progress(at, m.topics.length)));
  } else {
    main.append(span("mod-count", d.p.no_topics));
  }
  btn.append(main);
  card.append(btn);

  if (m.topics.length) {
    const list = document.createElement("ul");
    list.className = "topics";
    m.topics.forEach((tp, i) => list.append(topicRow(tp, i)));
    card.append(list);
  }
  return card;
}

export function renderCard(card: Card, onBack: () => void): void {
  const d = t();
  const now = Date.now();
  const view = beginScreen("screen--top", () => renderCard(card, onBack));
  view.append(backBar(d.m.back, onBack));
  view.append(cardHead(card));

  const prog = progressBlock(card);
  if (prog) view.append(prog);
  const strip = probationStrip(card, now);
  if (strip) view.append(strip);

  const waiting = waitingBlock(card);
  if (waiting) view.append(waiting);
  // The full note, and it sits directly under the topics that are waiting —
  // the exact moment a manager looks for a button to press.
  view.append(signoffNote(false));

  const block = document.createElement("section");
  block.className = "pp-block";
  block.append(text("h2", "sec-title", d.p.modules));
  if (!card.modules.length) {
    block.append(span("empty-note", d.p.empty_title));
  }
  card.modules.forEach((m, i) => block.append(moduleCard(m, i, now)));
  view.append(block);
  endScreen();
}

// ---------------------------------------------------------------------------
// Navigation. Two screens, one way between them — the same shape main.ts uses
// for the trainee, and for the same reason: the model is refetched rather than
// cached, so a screen can never be painted from data older than the one the
// mentor is looking at.
// ---------------------------------------------------------------------------

export async function showQueue(): Promise<void> {
  renderLoading();
  const res = await api<unknown>("/mentor/queue");
  if (res.kind === "fail") {
    renderStatus(res.status, () => void showQueue());
    return;
  }
  if (res.kind === "http") {
    // 403 here is a bound account the office has since blocked, deleted or
    // never gave a branch to. It is the same wall the trainee's `no_access`
    // describes, and it is not something a retry can move.
    renderStatus(res.code === 403 ? "no_access" : "unknown", () => void showQueue());
    return;
  }
  const q = parseQueue(res.data);
  if (!q) {
    renderStatus("unknown", () => void showQueue());
    return;
  }
  renderQueue(q, () => void showQueue(), (id) => void showTrainee(id));
}

export async function showTrainee(enrollmentId: string): Promise<void> {
  renderLoading();
  const res = await api<unknown>(`/mentor/trainee/${enrollmentId}`);
  if (res.kind === "fail") {
    renderStatus(res.status, () => void showTrainee(enrollmentId));
    return;
  }
  if (res.kind === "http") {
    // 404 (the enrollment was closed or removed while the queue was on
    // screen) and 403 (it moved to a branch this manager does not hold) both
    // mean the same thing to a person standing in a kitchen: the queue in
    // their hand is stale. Sending them back to a refetched queue says that
    // better than an error code.
    void showQueue();
    return;
  }
  const card = parseCard(res.data);
  if (!card) {
    renderStatus("unknown", () => void showTrainee(enrollmentId));
    return;
  }
  renderCard(card, () => void showQueue());
}
