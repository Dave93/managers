import { organization } from "backend/drizzle/schema";
import { and, eq } from "drizzle-orm";
import type { DbLike } from "../kpi/access";
import type { ConnKey, WorklyCreds } from "./types";

// Подключение Workly → название организации в таблице organization и компания Workly, чьи
// данные это подключение вправе читать (спека 5.1: company_id из /v1/accounts сверяется с ней).
export const CONNECTIONS: readonly { key: ConnKey; organizationName: string; companyId: number }[] = [
  { key: "LES", organizationName: "Les Ailes", companyId: 1237 },
  { key: "CHOPAR", organizationName: "ChoparPizza", companyId: 1238 },
];

// Ожидаемая компания подключения. Подмена только для тестов: подставные клиенты отдают
// случайные номера компаний. Подмена, вернувшая null, отключает проверку; null в сеттере
// возвращает константы из CONNECTIONS.
type ExpectedCompanyResolver = (key: ConnKey) => number | null;
let expectedCompanyResolver: ExpectedCompanyResolver | null = null;

export function setExpectedCompanyResolver(f: ExpectedCompanyResolver | null): void {
  expectedCompanyResolver = f;
}

export function expectedCompanyOf(key: ConnKey): number | null {
  if (expectedCompanyResolver) return expectedCompanyResolver(key);
  return CONNECTIONS.find((c) => c.key === key)?.companyId ?? null;
}

// Компания учётки совпадает с ожидаемой. Без ожидания (null) проверка пропускается.
export function companyMatches(expected: number | null, actual: number): boolean {
  return expected === null || expected === actual;
}

// Креды из переменных окружения; null, если нет хотя бы одной из пяти.
export function credsFromEnv(key: ConnKey, env: Record<string, string | undefined>): WorklyCreds | null {
  const baseUrl = env.WORKLY_BASE_URL;
  const clientId = env[`WORKLY_${key}_CLIENT_ID`];
  const clientSecret = env[`WORKLY_${key}_CLIENT_SECRET`];
  const username = env[`WORKLY_${key}_USERNAME`];
  const password = env[`WORKLY_${key}_PASSWORD`];
  if (!baseUrl || !clientId || !clientSecret || !username || !password) return null;
  return { key, baseUrl: baseUrl.replace(/\/+$/, ""), clientId, clientSecret, username, password };
}

// Организация подключения; null, если её нет или она выключена.
export async function organizationIdOf(db: DbLike, key: ConnKey): Promise<string | null> {
  const name = CONNECTIONS.find((c) => c.key === key)?.organizationName;
  if (!name) return null;
  const [row] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(and(eq(organization.name, name), eq(organization.active, true)))
    .limit(1);
  return row?.id ?? null;
}

// Организация подключения для маршрутов. Подмена только для тестов (как setConnKeyResolver
// в runs.ts): тестовые организации называются не как подключения. null снимает подмену.
type OrganizationResolver = (db: DbLike, key: ConnKey) => Promise<string | null>;
let organizationResolver: OrganizationResolver | null = null;

export function setOrganizationResolver(f: OrganizationResolver | null): void {
  organizationResolver = f;
}

export function resolveOrganizationId(db: DbLike, key: ConnKey): Promise<string | null> {
  return (organizationResolver ?? organizationIdOf)(db, key);
}

// Обратное соответствие: по организации находим подключение (нужно executeRun по строке журнала).
export async function connKeyOf(db: DbLike, organizationId: string): Promise<ConnKey | null> {
  const [row] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  return CONNECTIONS.find((c) => c.organizationName === row?.name)?.key ?? null;
}
