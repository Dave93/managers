import { organization } from "backend/drizzle/schema";
import { and, eq } from "drizzle-orm";
import type { DbLike } from "../kpi/access";
import type { ConnKey, WorklyCreds } from "./types";

// Подключение Workly → название организации в таблице organization.
export const CONNECTIONS: readonly { key: ConnKey; organizationName: string }[] = [
  { key: "LES", organizationName: "Les Ailes" },
  { key: "CHOPAR", organizationName: "ChoparPizza" },
];

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

// Обратное соответствие: по организации находим подключение (нужно executeRun по строке журнала).
export async function connKeyOf(db: DbLike, organizationId: string): Promise<ConnKey | null> {
  const [row] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  return CONNECTIONS.find((c) => c.organizationName === row?.name)?.key ?? null;
}
