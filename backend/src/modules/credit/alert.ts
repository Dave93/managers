// Best-effort alerting: this must NEVER throw. Its callers are maintenance jobs
// whose real work (reaping expired holds, reporting reconcile drift) is already
// done by the time they call here — an alert failure must not fail the job.
export async function creditAlert(text: string) {
  const token = process.env.CREDIT_ALERT_BOT_TOKEN;
  const chat = process.env.CREDIT_ALERT_CHAT_ID; // chat id comes from env — do not hardcode or document a specific group here
  if (!token || !chat) { console.warn("credit alert (no bot configured):", text); return; }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: `💳 credit: ${text}` }),
      // Telegram can hang rather than refuse (blocked egress, DNS blackhole); the
      // nightly reconcile job would otherwise sit on an open socket indefinitely.
      signal: AbortSignal.timeout(5000),
    });
    // fetch only rejects on transport failure — a 400 (bad chat_id), 401 (revoked
    // token) or 429 resolves normally, so without this check a permanently
    // misconfigured alert channel is indistinguishable from a healthy silent one.
    if (!res.ok) {
      const body = await res.text().catch(() => "<unreadable body>");
      console.error(`creditAlert HTTP ${res.status}:`, body, "| alert was:", text);
    }
  } catch (e) { console.error("creditAlert failed", e, "| alert was:", text); }
}
