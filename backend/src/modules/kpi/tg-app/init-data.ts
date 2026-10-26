// initData мини-приложения: подпись для тестов и dev-режима плана 7 и допуск токена бота.
// Без импортов базы и модулей KPI: юнит-тест импортирует файл без окружения.
import { createHmac } from "node:crypto";

// Обратная к verifyInitData из паспорта: тот же секрет HMAC_SHA256("WebAppData", token)
// и та же строка проверки — поля кроме hash по ключу, "k=v" через "\n".
export function signInitData(botToken: string, o: { telegram_id: number; auth_date: number; first_name?: string }): string {
  const fields: Record<string, string> = {
    auth_date: String(o.auth_date),
    query_id: "AAAkpitest",
    user: JSON.stringify({ id: o.telegram_id, first_name: o.first_name ?? "Тест" }),
  };
  const dataCheck = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheck).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

// Оба тестовых токена лежат в репозитории (123456:kpi-test-bot-token и 123456:kpi-smoke-dev-token):
// с ними кто угодно подпишет initData для любого telegram_id. Вне тестов и стенда такой токен не принимаем.
export const TEST_BOT_TOKEN_RE = /^123456:kpi-/;
export const TEST_PREFIXES: string[] = ["managers_test_", "managers_smoke_"];

export function tokenAllowed(token: string, projectPrefix: string | undefined): boolean {
  return !TEST_BOT_TOKEN_RE.test(token) || TEST_PREFIXES.includes(projectPrefix ?? "");
}
