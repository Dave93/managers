// Trainee passport miniapp — shell (Task C1).
//
// Scope of this file: get a session, decide which of the nine terminal screens
// the person is actually in, and hand off. The passport itself (C2), topics and
// quizzes (C3) and the mentor queue (C4) plug into renderPlaceholder's slots.
import "./style.css";
import { authenticate, api } from "./api";
import { setLang, storedLang } from "./i18n";
import { paintChrome } from "./telegram";
import { parseMe, renderPassport } from "./passport";
import {
  mountLangPanel,
  renderLoading,
  renderPlaceholder,
  renderStatus,
  setSlowHint,
} from "./ui";

const BG = "#121214";

// If the answer has not arrived by then, say something. A spinner with no
// explanation is exactly what a cook on dropping branch wifi reads as "broken".
const SLOW_AFTER_MS = 8_000;

let slowTimer: number | null = null;

function startLoading(): void {
  renderLoading();
  setSlowHint(false);
  if (slowTimer !== null) clearTimeout(slowTimer);
  slowTimer = window.setTimeout(() => setSlowHint(true), SLOW_AFTER_MS);
}

function stopLoading(): void {
  if (slowTimer !== null) clearTimeout(slowTimer);
  slowTimer = null;
  setSlowHint(false);
}

async function start(): Promise<void> {
  startLoading();

  const auth = await authenticate();
  if (auth.kind === "fail") {
    stopLoading();
    renderStatus(auth.status, start);
    return;
  }

  // Mentors deliberately skip /me. That route is the TRAINEE's: tg-controller's
  // traineeOrForbidden answers 403 {"error":"forbidden"} to any session whose
  // employee_id is null, so calling it here would turn a perfectly good mentor
  // login into a denial screen. The mentor's own endpoints arrive with C4.
  if (auth.role === "mentor") {
    stopLoading();
    renderPlaceholder("mentor");
    return;
  }

  const me = await api<unknown>("/me");
  stopLoading();

  if (me.kind === "fail") {
    renderStatus(me.status, start);
    return;
  }
  if (me.kind === "http") {
    // 404 no_enrollment: the account is bound but HR has not opened the
    // traineeship yet. A real, common state on day one -- and its own screen,
    // not a denial.
    if (me.code === 404) renderStatus("not_started", start);
    else renderStatus("unknown", start);
    return;
  }

  // A body that does not look like a passport is an error, not a passport with
  // holes in it: rendering half a screen would be worse than saying so.
  const data = parseMe(me.data);
  if (!data) {
    renderStatus("unknown", start);
    return;
  }
  // No onOpenTopic yet: C3 owns the topic screen and passes it here. Until then
  // the rows render as rows, not as buttons that do nothing.
  renderPassport(data);
}

// Language before first paint: the loading hint and every screen depend on it.
// storedLang() is this phone's own earlier choice; the server's `lang` arrives
// with the auth response and only seeds the case where there is no choice yet.
setLang(storedLang() ?? "ru", false);
mountLangPanel();
paintChrome(BG);
void start();
