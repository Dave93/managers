// Trainee passport miniapp — shell (Task C1).
//
// Scope of this file: get a session, decide which of the nine terminal screens
// the person is actually in, and hand off. The passport itself (C2), topics and
// quizzes (C3) and the mentor queue (C4) plug into renderPlaceholder's slots.
import "./style.css";
import { authenticate, api } from "./api";
import { setLang, storedLang } from "./i18n";
import { paintChrome } from "./telegram";
import { parseMe, renderPassport, type Me } from "./passport";
import { openTopic, showTopic, type TopicCtx } from "./topic";
import {
  mountLangPanel,
  renderLoading,
  renderPlaceholder,
  renderStatus,
} from "./ui";

const BG = "#121214";

// The "connection is slow" line used to be a setTimeout here. It is now an
// animation-delay in style.css, and that is a correctness fix rather than a
// stylistic one: this module is queued behind the deferred telegram.org
// script, so when that host is unreachable NOTHING in this file runs until the
// browser's network timeout expires. A timer that has not started cannot
// explain a shimmering skeleton. CSS runs regardless; see index.html.
//
// The paired teardown went with it: the hint lives inside #screen-loading, so
// rendering any other screen hides it.

/**
 * One fetch of the passport, with every terminal state already turned into a
 * screen. Returns null when it has rendered one, so callers just stop.
 */
async function loadMe(): Promise<Me | null> {
  const me = await api<unknown>("/me");

  if (me.kind === "fail") {
    renderStatus(me.status, start);
    return null;
  }
  if (me.kind === "http") {
    // 404 no_enrollment: the account is bound but HR has not opened the
    // traineeship yet. A real, common state on day one -- and its own screen,
    // not a denial.
    if (me.code === 404) renderStatus("not_started", start);
    else renderStatus("unknown", start);
    return null;
  }

  // A body that does not look like a passport is an error, not a passport with
  // holes in it: rendering half a screen would be worse than saying so.
  const data = parseMe(me.data);
  if (!data) {
    renderStatus("unknown", start);
    return null;
  }
  return data;
}

/**
 * Navigation, and it is the whole of it: two screens and one way between them.
 * The context is rebuilt from the payload each time rather than kept in a
 * variable, so a screen can never be rendered from a `me` older than the one
 * the trainee is looking at.
 */
function topicCtx(me: Me, topicId: string): TopicCtx {
  return {
    me,
    topicId,
    onBack: () => showPassport(me),
    onReload: () => void reload(topicId),
    onBackFresh: () => void reload(null),
  };
}

function showPassport(me: Me): void {
  renderPassport(me, (topicId) => openTopic(topicCtx(me, topicId)));
}

/**
 * Refetch and land where the caller asks. This is what a passed quiz comes back
 * through: the level on the passport must be the server's, never a number this
 * app raised on its own screen.
 */
async function reload(topicId: string | null): Promise<void> {
  renderLoading();
  const me = await loadMe();
  if (!me) return;
  if (topicId === null) showPassport(me);
  else showTopic(topicCtx(me, topicId));
}

async function start(): Promise<void> {
  renderLoading();

  const auth = await authenticate();
  if (auth.kind === "fail") {
    renderStatus(auth.status, start);
    return;
  }

  // Mentors deliberately skip /me. That route is the TRAINEE's: tg-controller's
  // traineeOrForbidden answers 403 {"error":"forbidden"} to any session whose
  // employee_id is null, so calling it here would turn a perfectly good mentor
  // login into a denial screen. The mentor's own endpoints arrive with C4.
  if (auth.role === "mentor") {
    renderPlaceholder("mentor");
    return;
  }

  const me = await loadMe();
  if (me) showPassport(me);
}

// Language before first paint. The inline script in index.html has already
// stamped <html lang> for the CSS-revealed loading hint; this repeats the read
// so the module's own `current` agrees with it, and so setLang keeps being the
// single place that owns the value. storedLang() is this phone's own earlier
// choice; the server's `lang` arrives with the auth response and only seeds
// the case where there is no choice yet.
setLang(storedLang() ?? "ru", false);
mountLangPanel();
paintChrome(BG);
void start();
