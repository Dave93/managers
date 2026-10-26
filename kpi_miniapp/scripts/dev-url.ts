// Ссылка на персону стенда managers_kpi_smoke для обычного Chrome: initData, подписанный тестовым
// токеном dev-backend, уходит в ?init=, а поддельный Telegram (dev-режим, только `vite serve`) отдаёт его приложению.
//
//   KPI_BOT_TOKEN=123456:kpi-smoke-dev-token bun scripts/dev-url.ts --tg 9100000001 [--theme light|dark] [--route /review/2026-10] [--port 5174]
//   KPI_BOT_TOKEN=123456:kpi-smoke-dev-token bun scripts/dev-url.ts --all
//
// Подписывает только тестовым токеном 123456:kpi-…: на сервере backend/.env бывает загружен в оболочку,
// и с боевым токеном скрипт выдал бы рабочий вход за любой telegram_id.
// initData живёт 24 часа (auth_date — сейчас): на следующий день ссылки нужно собрать заново.
import { TEST_BOT_TOKEN_RE, signInitData } from "../../backend/src/modules/kpi/tg-app/init-data";

// Персоны smoke-seed.ts (backend/src/modules/kpi/tg-app/smoke-seed.ts), в том же порядке.
const PERSONAS: [number, string][] = [
  [9100000001, "Смоук Оценка"],
  [9100000002, "Смоук Два месяца"],
  [9100000003, "Смоук Ждёт"],
  [9100000004, "Смоук Спор"],
  [9100000005, "Смоук Изменена"],
  [9100000006, "Смоук Максимум"],
  [9100000007, "Смоук Ждём HR"],
  [9100000008, "Смоук Решение"],
  [9100000009, "Смоук Без карты"],
  [9100000010, "Смоук Уволен"],
  [9100000011, "оценщик test_kpi_smoke_eval"],
  [9100000012, "Смоук Руководитель + оценщик test_kpi_smoke_lead"],
  [9100000013, "без привязки"],
  [9100000014, "Смоук Без прибавки"],
];

const USAGE =
  "использование: KPI_BOT_TOKEN=123456:kpi-… bun scripts/dev-url.ts --tg <id> [--theme light|dark] [--route /review/2026-10] [--port 5174] | --all";

function fail(msg: string): never {
  console.error(`dev-url: ${msg}`);
  process.exit(1);
}

function parseArgs(argv: string[]): { all: boolean; tg: number | null; theme: string; route: string; port: number } {
  const out = { all: false, tg: null as number | null, theme: "light", route: "/", port: 5174 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = (): string => {
      const x = argv[++i];
      if (x === undefined) fail(`${a}: нет значения\n${USAGE}`);
      return x;
    };
    if (a === "--all") out.all = true;
    else if (a === "--tg") {
      const s = v();
      if (!/^[1-9]\d{0,15}$/.test(s)) fail(`--tg: нужен telegram_id, а не «${s}»`);
      out.tg = Number(s);
    } else if (a === "--theme") {
      out.theme = v();
      if (out.theme !== "light" && out.theme !== "dark") fail("--theme: light или dark");
    } else if (a === "--route") {
      out.route = v();
      if (!out.route.startsWith("/")) fail("--route: путь с ведущим «/», например /review/2026-10");
    } else if (a === "--port") {
      const s = v();
      if (!/^\d{2,5}$/.test(s)) fail(`--port: нужен номер порта, а не «${s}»`);
      out.port = Number(s);
    } else fail(`непонятный аргумент «${a}»\n${USAGE}`);
  }
  if (!out.all && out.tg === null) fail(USAGE);
  return out;
}

// Токен проверяется раньше разбора аргументов: без тестового токена скрипт не печатает ничего, кроме отказа.
const token = process.env.KPI_BOT_TOKEN;
if (!token) fail("нужен KPI_BOT_TOKEN dev-backend");
if (!TEST_BOT_TOKEN_RE.test(token)) fail("только тестовый токен 123456:kpi-…, боевым не подписываю");

const args = parseArgs(process.argv.slice(2));

function url(telegramId: number): string {
  const init = signInitData(token!, { telegram_id: telegramId, auth_date: Math.floor(Date.now() / 1000) });
  return `http://localhost:${args.port}/kpi-app/?init=${encodeURIComponent(init)}&theme=${args.theme}#${args.route}`;
}

if (args.all) {
  for (const [tg, name] of PERSONAS) console.log(`${tg}  ${name}  ${url(tg)}`);
} else {
  console.log(url(args.tg!));
}
