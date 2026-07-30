export async function creditAlert(text: string) {
  const token = process.env.CREDIT_ALERT_BOT_TOKEN;
  const chat = process.env.CREDIT_ALERT_CHAT_ID; // monitoring supergroup -1003355511626
  if (!token || !chat) { console.warn("credit alert (no bot configured):", text); return; }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: `💳 credit: ${text}` }),
    });
  } catch (e) { console.error("creditAlert failed", e); }
}
