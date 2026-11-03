/**
 * Токен iikoCloud.
 *
 * iiko переводит API-ключи на новую схему: для таких ключей старый
 * `POST /api/1/access_token {apiLogin}` отвечает 403
 * «This API key does not support /api/1/access_token. Please use /api/v2/access_token instead.»
 * Новая схема — `POST /api/v2/access_token {appId, clientSecret, apiKey}`.
 *
 * appId и clientSecret хранятся в `credentials` организации рядом с `iiko_login`
 * (типы `iiko_app_id` и `iiko_client_secret`). Если их нет — работаем по старой схеме,
 * чтобы окружения со старыми ключами не сломались.
 */

export type CredentialRow = { type: string; key: string };

export type IikoCloudAuth = {
  /** apiLogin (старая схема) он же apiKey (новая схема) */
  apiLogin: string;
  appId?: string;
  clientSecret?: string;
};

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** Достаёт iiko-реквизиты авторизации из строк `credentials` организации. */
export function pickIikoAuth(creds: CredentialRow[]): IikoCloudAuth | null {
  const apiLogin = creds.find((c) => c.type === "iiko_login")?.key;
  if (!apiLogin) return null;
  return {
    apiLogin,
    appId: creds.find((c) => c.type === "iiko_app_id")?.key || undefined,
    clientSecret: creds.find((c) => c.type === "iiko_client_secret")?.key || undefined,
  };
}

/**
 * Возвращает токен iikoCloud. `baseUrl` — адрес вида `https://api-ru.iiko.services/api/1/`.
 * При ошибке бросает Error с кодом и описанием iiko; секреты в сообщение не попадают.
 */
export async function fetchIikoCloudToken(
  baseUrl: string,
  auth: IikoCloudAuth,
  fetchFn: FetchFn = fetch
): Promise<string> {
  const v2 = Boolean(auth.appId && auth.clientSecret);
  const url = (v2 ? baseUrl.replace("/api/1/", "/api/v2/") : baseUrl) + "access_token";
  const body = v2
    ? { appId: auth.appId, clientSecret: auth.clientSecret, apiKey: auth.apiLogin }
    : { apiLogin: auth.apiLogin };

  const res = await fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.token) {
    throw new Error(
      `iiko не выдал токен (${res.status}): ${json?.errorDescription ?? res.statusText ?? "нет описания"}`
    );
  }
  return json.token as string;
}
