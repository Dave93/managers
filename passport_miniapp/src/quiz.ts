// The quiz (Task C3).
//
// The rule this file exists to keep: THE SERVER GRADES. Nothing here counts a
// correct answer, computes a score or raises a level — `is_correct` never
// leaves the backend, the submit response carries the score and the new level,
// and every screen below renders what came back. A client-side percentage would
// be a guess dressed as a result, and on a passport that decides whether
// somebody keeps their job, that is the one lie that must not ship.
//
// The second rule is about the network. Branch wifi drops mid-quiz, and the
// attempt lives on the server: it is created by /start (a repeat call re-serves
// the SAME attempt) and closed by /submit. So a failed submit is a failed
// SUBMIT, not a lost quiz — the answers stay in memory and the trainee sends
// them again. Nothing here ever silently starts over.
import { api } from "./api";
import { t, type QuizErrKey } from "./i18n";
import {
  backButton,
  beginScreen,
  button,
  endScreen,
  renderLoading,
  renderOutcome,
  renderStatus,
  svgWrap,
  text,
  type OutcomeAction,
} from "./ui";

const GLYPH = {
  check: '<path d="M5 12.5 10 17.5 19 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
  redo: '<path d="M20 11a8 8 0 1 0-2.3 5.6"/><path d="M20 4.5V11h-6.5"/>',
  alert:
    '<path d="M12 4.5 2.8 20h18.4L12 4.5Z"/><line x1="12" y1="10" x2="12" y2="14"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  wifiOff:
    '<path d="M2 8.5a16 16 0 0 1 20 0"/><path d="M5 12a11 11 0 0 1 14 0"/><path d="M8.5 15.5a6 6 0 0 1 7 0"/><line x1="12" y1="19" x2="12.01" y2="19"/><line x1="3" y1="3" x2="21" y2="21"/>',
} as const;

export type QuizCtx = {
  topicId: string;
  topicTitle: string;
  hasObservation: boolean;
  /** Back to the topic screen with the data already in memory. */
  onExit: () => void;
  /** Refetch /me and re-render the topic screen from the server's answer. */
  onReload: () => void;
  /** Hand the server's new level back to the model behind this screen. */
  onLevel: (level: number) => void;
  /** The topic screen's mentor artefact, offered straight after a pass. */
  onCallMentor: () => void;
};

type Option = { id: string; text: string };
type Question = {
  id: string;
  text: string;
  type: "single" | "multi";
  options: Option[];
};

type Attempt = {
  ctx: QuizCtx;
  attemptId: string;
  passingScore: number;
  /** Absolute, from the server's own started_at; null when the test is untimed. */
  deadlineMs: number | null;
  questions: Question[];
  /** question id -> chosen option ids. The only thing this file remembers. */
  answers: Map<string, string[]>;
  index: number;
  sending: boolean;
};

/**
 * Module scope, not a closure inside the render function — exactly the reason
 * passport.ts keeps `expanded` out here. `mountLangPanel` repaints the current
 * screen when the language changes, so a current question or a set of
 * selections living inside the renderer would be thrown away by a tap on «O'z»
 * halfway through a quiz.
 */
let attempt: Attempt | null = null;

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------

let clockTimer: number | null = null;

function stopClock(): void {
  if (clockTimer !== null) {
    clearInterval(clockTimer);
    clockTimer = null;
  }
}

/**
 * Self-healing: it looks the node up every tick and stops the moment the node
 * is gone. Screens come and go here (question → confirm → result) and a timer
 * that had to be cancelled by each of them would eventually be leaked by one.
 */
function paintClock(): void {
  const node = document.querySelector<HTMLElement>(".q-clock");
  if (!node || !attempt || attempt.deadlineMs === null) {
    stopClock();
    return;
  }
  const left = attempt.deadlineMs - Date.now();
  const d = t();
  node.textContent = left <= 0 ? d.q.time_over : d.q.clock(Math.ceil(left / 60_000));
  node.dataset["over"] = left <= 0 ? "1" : "0";
}

function clockNode(): HTMLElement | null {
  if (!attempt || attempt.deadlineMs === null) return null;
  const node = text("span", "q-clock", "");
  stopClock();
  clockTimer = window.setInterval(paintClock, 10_000);
  // Painted once the node is actually in the document. setTimeout rather than
  // queueMicrotask: this runs on WebViews old enough to lack the latter.
  setTimeout(paintClock, 0);
  return node;
}

// ---------------------------------------------------------------------------
// Parsing the server's answer
// ---------------------------------------------------------------------------

/** Shallow shape check, same intent as parseMe: refuse to half-draw a quiz. */
function parseStart(data: unknown): Attempt["questions"] | null {
  if (!data || typeof data !== "object") return null;
  const raw = (data as Record<string, unknown>)["questions"];
  if (!Array.isArray(raw) || !raw.length) return null;
  const out: Question[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const q = item as Record<string, unknown>;
    if (typeof q["id"] !== "string" || typeof q["text"] !== "string") return null;
    if (!Array.isArray(q["options"])) return null;
    const options: Option[] = [];
    for (const o of q["options"] as unknown[]) {
      const opt = o as Record<string, unknown>;
      if (!opt || typeof opt["id"] !== "string" || typeof opt["text"] !== "string") {
        return null;
      }
      options.push({ id: opt["id"], text: opt["text"] });
    }
    out.push({
      id: q["id"],
      text: q["text"],
      // Anything that is not the multi enum grades as single-choice server-side.
      type: q["type"] === "multi" ? "multi" : "single",
      options,
    });
  }
  return out;
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Postgres timestamptz arrives as "2026-08-12 09:00:00+05", which Date.parse
 * does not accept everywhere — same normalisation as i18n.parseTs, kept local
 * so this module does not reach into the passport's date helpers for one line.
 */
function startedMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;
  const fixed = Date.parse(value.replace(" ", "T"));
  return Number.isNaN(fixed) ? null : fixed;
}

// ---------------------------------------------------------------------------
// Outcome screens
// ---------------------------------------------------------------------------

function errScreen(ctx: QuizCtx, key: QuizErrKey, reload = false): void {
  const d = t();
  renderOutcome({
    tone: key === "already_passed" ? "good" : "warn",
    paths: key === "already_passed" ? GLYPH.check : GLYPH.alert,
    title: d.q.err[key].title,
    body: d.q.err[key].body,
    actions: [
      { label: d.q.to_topic, onClick: reload ? ctx.onReload : ctx.onExit, primary: true },
    ],
    onRepaint: () => errScreen(ctx, key, reload),
  });
}

/**
 * The cooldown, rendered wherever it arrives from — and it arrives from
 * /start, not only after a failed submit: the counter lives in Redis, so a
 * trainee who fails twice, closes the app and comes back tomorrow morning
 * within the hour meets this screen cold, with no failure on screen to explain
 * it. Hence the body says WHAT happened as well as how long.
 */
function cooldownScreen(ctx: QuizCtx, seconds: number): void {
  const d = t();
  // Ceil, never floor: forty seconds left must not read «через 0 минут».
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  renderOutcome({
    tone: "warn",
    paths: GLYPH.clock,
    title: d.q.cooldown_title(minutes),
    body: d.q.cooldown_body,
    actions: [{ label: d.q.to_topic, onClick: ctx.onExit, primary: true }],
    onRepaint: () => cooldownScreen(ctx, seconds),
  });
}

type Result = { score: number; passed: boolean; expired: boolean };

function scoreLine(result: Result, passingScore: number): HTMLElement {
  const d = t();
  const row = document.createElement("div");
  row.className = "score";
  row.dataset["ok"] = result.passed ? "1" : "0";
  row.append(text("span", "score-value", d.q.score(result.score)));
  row.append(text("span", "score-need", d.q.need(passingScore)));
  return row;
}

function resultScreen(ctx: QuizCtx, result: Result, passingScore: number): void {
  const d = t();
  stopClock();
  const title = result.expired
    ? d.q.expired_title
    : result.passed
      ? d.q.passed_title
      : d.q.failed_title;
  const body = result.expired
    ? d.q.expired_body
    : result.passed
      ? ctx.hasObservation
        ? d.q.passed_body_mentor
        : d.q.passed_body_solo
      : d.q.failed_body;

  const actions: OutcomeAction[] = [];
  if (result.passed && ctx.hasObservation) {
    actions.push({ label: d.tp.call_mentor, onClick: ctx.onCallMentor, primary: true });
    actions.push({ label: d.q.to_topic, onClick: ctx.onReload });
  } else if (result.passed) {
    actions.push({ label: d.q.to_topic, onClick: ctx.onReload, primary: true });
  } else {
    // «Ещё раз» goes through /start, so a second failure lands on the cooldown
    // screen by the ordinary route rather than by a rule repeated here.
    actions.push({ label: d.q.retry, onClick: () => startQuiz(ctx), primary: true });
    actions.push({ label: d.q.to_topic, onClick: ctx.onReload });
  }

  renderOutcome({
    // Amber, not red: not passing is recoverable, and this screen has to be
    // read in a kitchen where red already means "you are late".
    tone: result.passed ? "good" : "warn",
    paths: result.passed ? GLYPH.check : result.expired ? GLYPH.clock : GLYPH.redo,
    title,
    body,
    extra: [scoreLine(result, passingScore)],
    actions,
    onRepaint: () => resultScreen(ctx, result, passingScore),
  });
}

/**
 * The submit did not reach the server. The attempt is still open server-side
 * and the answers are still in memory, so the honest move is to send them
 * again — never to reopen the quiz, which would look to the trainee like their
 * work was thrown away, and never to leave a spinner on screen.
 */
function sendFailedScreen(): void {
  const d = t();
  if (!attempt) return;
  renderOutcome({
    tone: "warn",
    paths: GLYPH.wifiOff,
    title: d.q.send_failed_title,
    body: d.q.send_failed_body,
    // Two moves, and neither of them throws the answers away. There is
    // deliberately no «Выйти» here: leaving from this screen would discard work
    // the copy has just promised is safe, and the way out — back to the
    // questions, then «Выйти» with its confirmation — is one tap further and
    // says what it costs.
    actions: [
      { label: d.q.send_again, onClick: () => void submit(), primary: true },
      { label: d.q.back_to_questions, onClick: () => renderQuestion() },
    ],
    onRepaint: sendFailedScreen,
  });
}

// ---------------------------------------------------------------------------
// The quiz itself
// ---------------------------------------------------------------------------

function selected(q: Question): string[] {
  return attempt?.answers.get(q.id) ?? [];
}

function answeredCount(): number {
  if (!attempt) return 0;
  let n = 0;
  for (const q of attempt.questions) if (selected(q).length) n += 1;
  return n;
}

function progressBar(): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "q-segs";
  if (!attempt) return bar;
  attempt.questions.forEach((q, i) => {
    const seg = document.createElement("i");
    seg.dataset["state"] =
      i === attempt!.index ? "now" : selected(q).length ? "done" : "todo";
    bar.append(seg);
  });
  return bar;
}

function optionButton(q: Question, option: Option): HTMLElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "opt";
  const chosen = selected(q).includes(option.id);
  node.dataset["on"] = chosen ? "1" : "0";
  node.setAttribute("aria-pressed", chosen ? "true" : "false");

  const box = document.createElement("span");
  box.className = `opt-box opt-box--${q.type}`;
  if (chosen) box.innerHTML = svgWrap(GLYPH.check);
  node.append(box);
  node.append(text("span", "opt-text", option.text));

  node.addEventListener("click", () => {
    if (!attempt) return;
    const current = selected(q);
    // Single-choice replaces, multi toggles. Deliberately no auto-advance on a
    // single-choice tap: on a phone held one-handed in a kitchen, a mis-tap
    // that also turns the page is a mis-tap you cannot see you made.
    const next =
      q.type === "multi"
        ? current.includes(option.id)
          ? current.filter((id) => id !== option.id)
          : [...current, option.id]
        : [option.id];
    attempt.answers.set(q.id, next);
    renderQuestion();
  });
  return node;
}

function renderQuestion(): void {
  const d = t();
  if (!attempt) return;
  const state = attempt;
  const q = state.questions[state.index];
  if (!q) return;

  const view = beginScreen("screen--top screen--quiz", renderQuestion);

  const bar = document.createElement("div");
  bar.className = "q-bar";
  bar.append(backButton(d.q.leave, leaveScreen));
  bar.append(text("span", "q-count", d.q.progress(state.index + 1, state.questions.length)));
  const clock = clockNode();
  if (clock) bar.append(clock);
  view.append(bar);
  view.append(progressBar());

  view.append(text("h1", "q-text", q.text));
  view.append(
    text("span", "q-hint", q.type === "multi" ? d.q.multi_hint : d.q.single_hint)
  );

  const list = document.createElement("div");
  list.className = "opts";
  for (const option of q.options) list.append(optionButton(q, option));
  view.append(list);

  const foot = document.createElement("div");
  foot.className = "q-foot";
  if (state.index > 0) {
    foot.append(
      button("btn-ghost", d.q.prev, () => {
        state.index -= 1;
        renderQuestion();
      })
    );
  }
  const last = state.index === state.questions.length - 1;
  foot.append(
    button("btn-primary", last ? d.q.review : d.q.next, () => {
      if (last) confirmScreen();
      else {
        state.index += 1;
        renderQuestion();
      }
    })
  );
  view.append(foot);
  endScreen();
}

/** Leaving mid-quiz. The attempt survives on the server; the answers do not. */
function leaveScreen(): void {
  const d = t();
  if (!attempt) return;
  const ctx = attempt.ctx;
  stopClock();
  renderOutcome({
    tone: "neutral",
    paths: GLYPH.alert,
    title: d.q.leave_title,
    body: d.q.leave_body,
    actions: [
      { label: d.q.leave_cancel, onClick: () => renderQuestion(), primary: true },
      {
        label: d.q.leave_confirm,
        onClick: () => {
          attempt = null;
          ctx.onExit();
        },
      },
    ],
    onRepaint: leaveScreen,
  });
}

/**
 * The confirmation. One tap closes the attempt for good and can arm an
 * hour-long cooldown, so this screen says both things BEFORE the tap — and
 * lists the questions, so a skipped one is found here rather than discovered in
 * the score.
 */
function confirmScreen(): void {
  const d = t();
  if (!attempt) return;
  const state = attempt;
  const view = beginScreen("screen--top screen--quiz", confirmScreen);

  const bar = document.createElement("div");
  bar.className = "q-bar";
  // Frozen while the answers are in the air, together with the review rows
  // below: the send button already was, and leaving the other two live let a
  // trainee walk away mid-send into the very race the guard in submit() now
  // catches. Closing the door is the better half of the fix — the guard then
  // only has to be right, not also reachable.
  const back = backButton(d.q.back_to_questions, () => renderQuestion());
  back.disabled = state.sending;
  bar.append(back);
  const clock = clockNode();
  if (clock) bar.append(clock);
  view.append(bar);

  view.append(text("h1", "q-confirm-title", d.q.confirm_title));

  const done = answeredCount();
  const tally = document.createElement("div");
  tally.className = "tally";
  tally.dataset["all"] = done === state.questions.length ? "1" : "0";
  tally.append(text("span", "tally-main", d.q.answered(done, state.questions.length)));
  if (done < state.questions.length) {
    tally.append(text("span", "tally-warn", d.q.unanswered(state.questions.length - done)));
  }
  view.append(tally);

  const list = document.createElement("ul");
  list.className = "rev";
  state.questions.forEach((q, i) => {
    const li = document.createElement("li");
    const row = document.createElement("button");
    row.type = "button";
    row.className = "rev-row";
    row.disabled = state.sending;
    row.dataset["on"] = selected(q).length ? "1" : "0";
    row.append(text("span", "rev-idx", String(i + 1)));
    row.append(text("span", "rev-text", q.text));
    row.addEventListener("click", () => {
      state.index = i;
      renderQuestion();
    });
    li.append(row);
    list.append(li);
  });
  view.append(list);

  const foot = document.createElement("div");
  foot.className = "q-foot q-foot--stack";
  foot.append(text("p", "q-rule", d.q.confirm_body));
  foot.append(text("p", "q-rule", d.q.confirm_rule));
  const send = button("btn-primary", state.sending ? d.q.sending : d.q.send, () => {
    if (state.sending) return;
    void submit();
  });
  send.disabled = state.sending;
  foot.append(send);
  view.append(foot);
  endScreen();
}

// ---------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------

async function submit(): Promise<void> {
  if (!attempt || attempt.sending) return;
  const state = attempt;
  const ctx = state.ctx;
  state.sending = true;
  confirmScreen();

  const res = await api<Record<string, unknown>>(`/quiz/${ctx.topicId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      attempt_id: state.attemptId,
      answers: state.questions.map((q) => ({
        question_id: q.id,
        selected_option_ids: state.answers.get(q.id) ?? [],
      })),
    }),
  });

  // GENERATION GUARD, and it belongs before every line below it.
  //
  // `state` was captured before the await; the module-level `attempt` was not.
  // A submit can be in flight for up to the 15s API timeout, and in that window
  // the trainee can leave: leaveScreen nulls `attempt` and exits to the topic,
  // or they start the quiz again and /start mints a NEW attempt. `state`
  // survives both, so without this the resolved answer went on to call
  // ctx.onLevel and paint a result — «Квиз сдан» over the topic screen for an
  // attempt they were just told stays open, or attempt A's verdict over
  // attempt B's live question. Identity, not a boolean: a fresh attempt object
  // is as stale a target as none at all. topic.ts guards its own late /opened
  // response the same way, with a counter.
  if (attempt !== state) return;
  state.sending = false;

  if (res.kind === "fail") {
    // Timeout, dead radio, 5xx. The attempt is still open on the server, so
    // this is a retry of the SEND, not of the quiz.
    if (res.status === "offline") {
      sendFailedScreen();
      return;
    }
    renderStatus(res.status, () => void submit());
    return;
  }

  if (res.kind === "http") {
    if (res.code === 409) {
      // The attempt is already finalised — most often OUR previous submit,
      // whose response the network ate. It was graded, but the grade is not
      // readable from here and an unchanged level is indistinguishable from a
      // submit that never landed, so this screen claims neither: it refetches
      // and sends the trainee to the topic, where the server's own state is.
      attempt = null;
      errScreen(ctx, "finalized", true);
      return;
    }
    if (res.code === 404) {
      attempt = null;
      errScreen(ctx, res.error === "topic_not_found" ? "topic_gone" : "attempt_gone", true);
      return;
    }
    renderStatus("unknown", () => void submit());
    return;
  }

  const level = res.data["level"];
  if (typeof level === "number") ctx.onLevel(level);
  const result: Result = {
    score: num(res.data["score"], 0),
    passed: res.data["passed"] === true,
    expired: res.data["expired"] === true,
  };
  const passingScore = state.passingScore;
  attempt = null;
  resultScreen(ctx, result, passingScore);
}

export function startQuiz(ctx: QuizCtx): void {
  attempt = null;
  stopClock();
  renderLoading();
  void api<Record<string, unknown>>(`/quiz/${ctx.topicId}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).then((res) => {
    if (res.kind === "fail") {
      renderStatus(res.status, () => startQuiz(ctx));
      return;
    }
    if (res.kind === "http") {
      if (res.code === 429) {
        // The server's own remaining TTL, in seconds. Falling back to the full
        // hour only when the body is unreadable: overstating the wait is the
        // safe direction, understating it sends somebody back to a locked quiz.
        cooldownScreen(ctx, num(res.body?.["retry_after_sec"], 3600));
        return;
      }
      if (res.code === 409) {
        errScreen(ctx, "already_passed", true);
        return;
      }
      if (res.code === 400) {
        errScreen(ctx, res.error === "no_quiz" ? "no_quiz" : "no_questions");
        return;
      }
      if (res.code === 404) {
        errScreen(ctx, res.error === "test_not_found" ? "test_gone" : "topic_gone", true);
        return;
      }
      renderStatus("unknown", () => startQuiz(ctx));
      return;
    }

    const questions = parseStart(res.data);
    if (!questions) {
      renderStatus("unknown", () => startQuiz(ctx));
      return;
    }
    const id = res.data["attempt_id"];
    if (typeof id !== "string") {
      renderStatus("unknown", () => startQuiz(ctx));
      return;
    }
    const limit = res.data["time_limit_minutes"];
    const began = startedMs(res.data["started_at"]);
    attempt = {
      ctx,
      attemptId: id,
      passingScore: num(res.data["passing_score"], 0),
      deadlineMs:
        typeof limit === "number" && began !== null ? began + limit * 60_000 : null,
      questions,
      // A re-served attempt (the backend hands back the SAME in-flight paper on
      // a repeat start) arrives here as a fresh set of empty answers. That is
      // correct: the selections were only ever on the phone, and the server has
      // recorded none of them until submit.
      answers: new Map(),
      index: 0,
      sending: false,
    };
    renderQuestion();
  });
}
