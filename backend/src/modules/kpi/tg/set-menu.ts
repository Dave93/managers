// Разовая настройка кнопки меню «Мой KPI» у бота. Запускается вручную после выкладки мини-приложения
// и после каждой смены KPI_MINIAPP_URL:
//   cd backend && bun run src/modules/kpi/tg/set-menu.ts
// Ходит в настоящий Telegram, в тестах и планах не запускать. Ставит кнопку бота по умолчанию, свою кнопку узбекским
// чатам и сбрасывает русские чаты на кнопку по умолчанию. Каждая неудача печатается с причиной (без токена), в конце —
// итоговая строка. Код выхода 1: нет токена, нет https-адреса или не встала кнопка по умолчанию.
import { drizzleDb } from "@backend/lib/db";
import { kpi_tg_bindings } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import { realBotApi } from "./bot-api";
import { applyMenuPlan, menuPlan } from "./menu";
import { miniAppUrl } from "./miniapp-url";

const redact = (s: string) => {
  const token = process.env.KPI_BOT_TOKEN;
  return token ? s.replaceAll(token, "***") : s;
};

async function main(): Promise<number> {
  const token = process.env.KPI_BOT_TOKEN;
  if (!token) {
    console.error("kpi menu: KPI_BOT_TOKEN не задан");
    return 1;
  }
  const url = miniAppUrl();
  if (!url) {
    console.error("kpi menu: KPI_MINIAPP_URL не задан или не годится (нужен https-адрес с хостом, без ? и #)");
    return 1;
  }
  const rows = await drizzleDb
    .selectDistinct({ telegram_id: kpi_tg_bindings.telegram_id, lang: kpi_tg_bindings.lang })
    .from(kpi_tg_bindings)
    .where(eq(kpi_tg_bindings.active, true));
  const plan = menuPlan(
    rows.map((r) => ({ telegram_id: Number(r.telegram_id), lang: r.lang === "uz" ? "uz" : "ru" })),
    url,
  );
  const ok = await applyMenuPlan(realBotApi(token), plan, token, {
    info: (line) => console.log(line),
    error: (line) => console.error(line),
  });
  return ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(`kpi menu: ${redact(e instanceof Error ? e.message : String(e))}`);
    process.exit(1);
  });
