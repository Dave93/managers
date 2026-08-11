// The only part of the Telegram WebApp SDK this app touches, typed by hand.
//
// The SDK itself is a <script> tag in index.html pointing at telegram.org, NOT
// an npm dependency: Telegram serves a rolling unversioned file and expects
// exactly that include (the same call the deployed les_training_miniapp makes).
// Consequence worth stating out loud: on a phone that cannot reach
// telegram.org, `window.Telegram` is undefined and `initData()` returns "" --
// which is the same observable state as "opened outside Telegram", and the
// shell shows one honest screen for both.
export type TelegramWebApp = {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function webApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

/**
 * The signed blob, verbatim.
 *
 * Deliberately NOT parsed here. `start_param` (the `inv_<uuid>` from the
 * printed QR) is inside this string, and the backend pulls it out of the blob
 * it has just verified -- see verifyInitData in tg-auth.ts. If the client read
 * start_param separately and posted it as its own field, that field would be
 * unsigned and forgeable: anyone could redeem any invite id. So the client's
 * whole job is to hand over the blob and touch nothing in it.
 */
export function initData(): string {
  return webApp()?.initData ?? "";
}

/** Chrome-in-Telegram colours; each guarded because old clients lack them. */
export function paintChrome(color: string): void {
  const app = webApp();
  if (!app) return;
  try {
    app.ready?.();
    app.expand?.();
  } catch {
    /* older clients */
  }
  try {
    app.setHeaderColor?.(color);
  } catch {
    /* not supported before Bot API 6.1 */
  }
  try {
    app.setBackgroundColor?.(color);
  } catch {
    /* not supported before Bot API 6.1 */
  }
}
