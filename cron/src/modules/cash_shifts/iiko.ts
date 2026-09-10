// Minimal resto API client for the cash shift sync: one token, re-auth on 401
// (a re-auth does not use up a retry), logout on demand. Every holder of a
// token occupies an iiko license seat until it logs out or the token expires.
const BASE = "https://les-ailes-co-co.iiko.it/resto/api";
const MAX_ATTEMPTS = 3;

export class IikoResto {
  private token: string | null = null;

  async auth(): Promise<string> {
    const res = await fetch(
      `${BASE}/auth?login=${encodeURIComponent(process.env.IIKO_LOGIN ?? "")}&pass=${encodeURIComponent(process.env.IIKO_PASSWORD ?? "")}`
    );
    const token = (await res.text()).trim();
    if (!res.ok || !/^[0-9a-f-]{30,40}$/i.test(token)) {
      throw new Error(`[auth] failed, status ${res.status}, body: ${token.slice(0, 120)}`);
    }
    this.token = token;
    return token;
  }

  async request(
    method: "GET" | "POST",
    path: string,
    params: Record<string, string> = {},
    body?: unknown
  ): Promise<Response> {
    let reauths = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const key = this.token ?? (await this.auth());
        const qs = new URLSearchParams({ key, ...params });
        const res = await fetch(`${BASE}${path}?${qs}`, {
          method,
          headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : undefined,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(600_000),
        });
        if (res.status === 401 && reauths < 2) {
          reauths++;
          this.token = null;
          attempt--;
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}: ${(await res.text()).slice(0, 200)}`);
        return res;
      } catch (e) {
        console.error(`[iiko] ${path} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${(e as Error).message}`);
        if (attempt === MAX_ATTEMPTS) throw e;
        await Bun.sleep(10_000 * attempt);
      }
    }
    throw new Error("unreachable");
  }

  async logout(): Promise<void> {
    if (!this.token) return;
    try {
      await fetch(`${BASE}/logout?key=${this.token}`);
    } catch (e) {
      console.error(`[iiko] logout failed: ${(e as Error).message}`);
    }
    this.token = null;
  }
}
