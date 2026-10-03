// The topic screen — where the learning actually happens (Task C3).
//
// It renders from the /me payload the passport already has. There is no
// GET /tg/topics/:id on the backend and this screen does not need one: /me
// carries step/key_point/reason/video_id for every topic in the programme, so
// opening a topic on branch wifi paints instantly instead of waiting on a
// request that may never come back.
//
// Three things, top to bottom:
//   material — «шаг → ключевой момент → почему», the TWI card a trainer would
//              talk through, in the same three words they use out loud.
//   action   — exactly ONE next move, decided by the level the server reports.
//   mentor   — after the quiz, the screen the trainee holds up to a mentor.
//
// What this screen must never do, and the reason the whole product exists: it
// must not become a place where somebody else can take the quiz. It says out
// loud, before the quiz opens, that the quiz is taken alone and that the
// practical half is signed by a different person — so the rule reads as the
// design it is, not as an accusation.
import { api } from "./api";
import { lang, t } from "./i18n";
import type { Me, Topic, TopicRow } from "./passport";
import { BAR, local } from "./passport";
import {
  backBar,
  beginScreen,
  button,
  endScreen,
  glyphBox,
  svgWrap,
  text,
} from "./ui";
import { startQuiz } from "./quiz";

/**
 * Navigation counter. `openTopic` fires the journal write and then repaints
 * with the level the server sends back — but branch wifi means that answer can
 * arrive a second late, by which time the trainee may be inside the quiz. Every
 * move away from the topic screen bumps this, and the late repaint checks it
 * first, so a slow response can update the model without yanking a screen out
 * from under a finger.
 */
let nav = 0;

function mark(): number {
  return ++nav;
}

/** Leave for somewhere this module does not own; the repaint must not fire. */
function leave(go: () => void): () => void {
  return () => {
    mark();
    go();
  };
}

const GLYPH = {
  play: '<circle cx="12" cy="12" r="9"/><path d="M10.5 8.8 15.5 12l-5 3.2V8.8Z"/>',
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  mentor:
    '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 12.5l2 2 4-4"/>',
} as const;

export type TopicCtx = {
  me: Me;
  topicId: string;
  /** Back to the passport, with whatever data is current. */
  onBack: () => void;
  /** Refetch /me and re-render this same topic from the server's answer. */
  onReload: () => void;
  /**
   * Refetch /me and land on the PASSPORT. The mentor screen's way out, and the
   * one post-pass route that otherwise never refetched: a pass reaches it
   * straight from the result screen, so the model behind it carries only the
   * level the submit returned. Everything else /me may have changed — a stamp,
   * a module rolling over — would have been missing until the next cold start.
   */
  onBackFresh: () => void;
};

/** The topic and its level, or null if this id is not in the payload. */
function find(me: Me, topicId: string): { row: TopicRow; module: string } | null {
  for (const m of me.modules) {
    for (const row of m.topics) {
      if (row.topic.id === topicId) {
        return { row, module: local(m.module.title_ru, m.module.title_uz) };
      }
    }
  }
  return null;
}

function twi(label: string, value: string, cls: string): HTMLElement {
  const block = document.createElement("div");
  block.className = `twi ${cls}`;
  block.append(text("span", "twi-label", label));
  // textContent, and `white-space: pre-line` in the stylesheet: HR writes these
  // fields as several short lines, and collapsing them into one paragraph is
  // how a checklist stops reading as a checklist. Never innerHTML — this text
  // comes from a form.
  block.append(text("p", "twi-body", value.trim()));
  return block;
}

/**
 * The material card. Every column is `.default("")`, so an empty string is HR
 * leaving the field blank rather than a missing field — each block is skipped
 * on its own, and a topic with nothing at all says so instead of rendering an
 * empty card the trainee would read as a broken app.
 */
function material(topic: Topic): HTMLElement {
  const d = t();
  const uz = lang() === "uz";
  const parts: [string, string, string][] = [
    [d.tp.step, uz && topic.step_uz.trim() ? topic.step_uz : topic.step_ru, "twi--step"],
    [
      d.tp.key_point,
      uz && topic.key_point_uz.trim() ? topic.key_point_uz : topic.key_point_ru,
      "twi--key",
    ],
    [
      d.tp.reason,
      uz && topic.reason_uz.trim() ? topic.reason_uz : topic.reason_ru,
      "twi--why",
    ],
  ];
  const filled = parts.filter(([, value]) => value.trim().length > 0);

  const card = document.createElement("section");
  card.className = "card twi-card";
  if (!filled.length) {
    card.append(text("p", "card-body", d.tp.no_material));
    return card;
  }
  for (const [label, value, cls] of filled) card.append(twi(label, value, cls));
  return card;
}

/**
 * The video slot, and it is deliberately not a player.
 *
 * `passport_topics.video_id` exists and the admin API can set it, but NOTHING
 * on this backend serves the bytes: there is no route touching passport_media
 * anywhere in backend/src, and the nginx X-Accel location belongs to a later
 * stage. A <video> here would point at a guessed path and show a broken frame,
 * so a topic that HAS a video says one muted line and the trainee knows to ask
 * rather than to wonder what failed. Unreachable today — passport_media is
 * empty — and it will start rendering the moment HR attaches one.
 */
function videoNote(topic: Topic): HTMLElement | null {
  if (!topic.video_id) return null;
  const row = document.createElement("div");
  row.className = "vid-note";
  const glyph = document.createElement("span");
  glyph.className = "vid-glyph";
  glyph.innerHTML = svgWrap(GLYPH.play);
  row.append(glyph);
  row.append(text("span", "vid-text", t().tp.video_note));
  return row;
}

function header(name: string, moduleTitle: string, level: number, topic: Topic): HTMLElement {
  const d = t();
  const node = document.createElement("header");
  node.className = "tp-head";
  node.append(text("span", "tp-crumb", moduleTitle));
  node.append(text("h1", "tp-h", name));

  const meta = document.createElement("div");
  meta.className = "tp-meta";
  const level_ = span("tp-level", d.p.level[Math.min(4, Math.max(0, level))] ?? "");
  level_.dataset["l"] = String(level);
  meta.append(level_);
  // The one state where the trainee is not the one who is stuck. Same sentence
  // as the passport row, so the two screens agree.
  if (level === 2 && topic.has_observation) meta.append(span("tp-wait", d.p.need_mentor));
  node.append(meta);
  return node;
}

function span(cls: string, value: string): HTMLElement {
  return text("span", cls, value);
}

/** A titled card with a body line, used by both "next" states. */
function nextCard(title: string, body: string): HTMLElement {
  const card = document.createElement("section");
  card.className = "card next-card";
  card.append(text("h2", "next-title", title));
  card.append(text("p", "card-body", body));
  return card;
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

/**
 * The mentor screen. It calls nobody — there is no such endpoint, and inventing
 * one in the copy would leave a trainee waiting for a person who was never
 * told. So the screen is the ARTEFACT: the thing you walk over and hold up,
 * with the topic on it and the rule about where the signature is actually
 * recorded, worded exactly as the mentor's own screen words it.
 */
function mentorScreen(ctx: TopicCtx, found: { row: TopicRow; module: string }): void {
  const d = t();
  mark();
  const { row, module } = found;
  const view = beginScreen("screen--top", () => mentorScreen(ctx, found));
  view.append(backBar(d.tp.back, () => showTopic(ctx)));

  const head = document.createElement("div");
  head.className = "mentor-head";
  head.append(glyphBox("good", GLYPH.mentor));
  head.append(text("h1", "status-title", d.tp.mentor_title));
  head.append(text("p", "status-body", d.tp.mentor_body));
  view.append(head);

  const card = document.createElement("section");
  card.className = "card show-card";
  card.append(text("span", "show-label", d.tp.mentor_topic));
  card.append(text("p", "show-topic", local(row.topic.title_ru, row.topic.title_uz)));
  card.append(text("span", "show-module", module));
  if (row.topic.has_quiz && row.level >= 2) {
    const chip = span("chip chip--done show-chip", d.tp.passed_chip);
    card.append(chip);
  }
  card.append(text("p", "card-note", d.tp.mentor_what));
  // Verbatim the mentor placeholder's own line: one rule, one wording.
  card.append(text("p", "card-note", d.mentor_signoff_note));
  view.append(card);

  const foot = document.createElement("div");
  foot.className = "tp-foot";
  foot.append(button("btn-ghost", d.tp.to_passport, leave(ctx.onBackFresh)));
  view.append(foot);
  endScreen();
}

/** The action block: exactly one next move, chosen by the server's level. */
function action(ctx: TopicCtx, found: { row: TopicRow; module: string }): HTMLElement {
  const d = t();
  const { row } = found;
  const topic = row.topic;
  const foot = document.createElement("div");
  foot.className = "tp-foot";

  const callMentor = (): void => mentorScreen(ctx, found);

  if (row.level >= BAR) {
    foot.append(nextCard(d.tp.done_title, d.tp.done_body));
    foot.append(button("btn-ghost", d.tp.to_passport, leave(ctx.onBack)));
    return foot;
  }

  if (topic.has_quiz && row.level < 2) {
    foot.append(text("p", "tp-rule", d.tp.quiz_hint));
    foot.append(
      button(
        "btn-primary",
        d.tp.start_quiz,
        leave(() =>
          startQuiz({
            topicId: topic.id,
            topicTitle: local(topic.title_ru, topic.title_uz),
            hasObservation: topic.has_observation,
            onExit: () => showTopic(ctx),
            onReload: leave(ctx.onReload),
            // The level the SERVER returned with the submit, written back into
            // the model so the passport behind this screen agrees with it. Not
            // an optimistic raise: this number was computed by state.ts.
            onLevel: (level) => {
              row.level = level;
            },
            onCallMentor: callMentor,
          })
        )
      )
    );
    return foot;
  }

  if (topic.has_observation) {
    foot.append(
      topic.has_quiz
        ? nextCard(d.tp.mentor_next_title, d.tp.mentor_next_body)
        : nextCard(d.tp.observation_only_title, d.tp.observation_only_body)
    );
    foot.append(button("btn-primary", d.tp.call_mentor, callMentor));
    return foot;
  }

  // Quiz-only at level 2 is not reachable through state.ts (a passed quiz on
  // such a topic goes straight to 3), but a level arriving from anywhere else
  // must not produce a screen with no way forward.
  foot.append(button("btn-ghost", d.tp.to_passport, leave(ctx.onBack)));
  return foot;
}

/** Render only. `openTopic` is the entry point that also journals the open. */
export function showTopic(ctx: TopicCtx): void {
  const d = t();
  mark();
  const found = find(ctx.me, ctx.topicId);
  // The topic vanished from under the screen — HR deactivated the module while
  // it was open, and the refetch came back without it. The passport is the
  // honest place to land: it is the list that is current.
  if (!found) {
    ctx.onBack();
    return;
  }
  const { row, module } = found;
  const topic = row.topic;

  const view = beginScreen("screen--top", () => showTopic(ctx));
  view.append(backBar(d.tp.back, leave(ctx.onBack)));
  view.append(header(local(topic.title_ru, topic.title_uz), module, row.level, topic));

  const video = videoNote(topic);
  if (video) view.append(video);

  view.append(material(topic));
  view.append(action(ctx, found));
  endScreen();
}

/**
 * Open a topic: paint it, then tell the server it was opened.
 *
 * The order is deliberate. The material is already in memory, so the screen
 * owes nothing to the network; the journal write is best-effort and its failure
 * is not the trainee's problem — a cook who cannot reach the server still needs
 * to read the material. The endpoint is idempotent by design (the level only
 * ever rises to 1 and a repeat writes no second journal row), so this fires on
 * every open with no client-side bookkeeping pretending otherwise.
 */
export function openTopic(ctx: TopicCtx): void {
  showTopic(ctx);
  const found = find(ctx.me, ctx.topicId);
  if (!found) return;
  const gen = nav;
  void api<{ level?: unknown }>(`/topics/${ctx.topicId}/opened`, {
    method: "POST",
    // A plain object literal, which api() folds into a Headers instance. The
    // route takes no body; "{}" keeps the Content-Type honest.
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).then((res) => {
    // Best effort, and silently so: a cook whose phone cannot reach the server
    // still needs to read the material, and a failed journal write is not
    // something they can act on. It is recorded again the next time they open
    // the topic, because the endpoint is idempotent.
    if (res.kind !== "ok") return;
    const level = res.data.level;
    if (typeof level !== "number" || level === found.row.level) return;
    found.row.level = level;
    // Only if the trainee is still looking at this screen. The quiz, the mentor
    // screen and the passport all bump `nav` on their way in.
    if (gen === nav) showTopic(ctx);
  });
}
