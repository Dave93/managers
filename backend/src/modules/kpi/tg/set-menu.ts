// Разовая настройка кнопки меню «Мой KPI» у бота. Запускается вручную после выкладки мини-приложения:
//   cd backend && bun run src/modules/kpi/tg/set-menu.ts
// Ходит в настоящий Telegram, в тестах и планах не запускать. Код выхода 1: нет токена, нет https-адреса
// или не встала кнопка по умолчанию; неудачи отдельных чатов (узбекские) видны только в итоговой строке.
import { drizzleDb } from "@backend/lib/db";
import { kpi_tg_bindings } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import { realBotApi } from "./bot-api";
import { menuPlan } from "./menu";
import { miniAppUrl } from "./miniapp-url";

async function main(): Promise<number> {
  const token = process.env.KPI_BOT_TOKEN;
  if (!token) {
    console.error("kpi menu: KPI_BOT_TOKEN не задан");
    return 1;
  }
  const url = miniAppUrl();
  if (!url) {
    console.error("kpi menu: KPI_MINIAPP_URL не задан или не https");
    return 1;
  }
  const rows = await drizzleDb
    .selectDistinct({ telegram_id: kpi_tg_bindings.telegram_id, lang: kpi_tg_bindings.lang })
    .from(kpi_tg_bindings)
    .where(eq(kpi_tg_bindings.active, true));
  const plan = menuPlan(rows.map((r) => ({ telegram_id: Number(r.telegram_id), lang: r.lang === "uz" ? "uz" : "ru" })));
  const api = realBotApi(token);
  let defaultOk = false;
  let uzOk = 0;
  let uzAll = 0;
  // По очереди, чтобы не упереться в лимит Telegram.
  for (const step of plan) {
    const res = await api.setMenuButton!(step.chatId, step.text, url);
    if (step.chatId === null) defaultOk = res.ok;
    else {
      uzAll++;
      if (res.ok) uzOk++;
    }
  }
  console.log(`kpi menu: default ${defaultOk ? "ok" : "fail"}, uz chats ${uzOk}/${uzAll}`);
  return defaultOk ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`kpi menu: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
