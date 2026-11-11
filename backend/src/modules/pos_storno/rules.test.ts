import { describe, expect, it } from "bun:test";
import {
  bearerToken,
  cancelDecision,
  clip,
  decideReport,
  generateToken,
  hashToken,
  identityDecision,
  isPluginStatus,
  LEASE_SECONDS,
  normalizeRegisterNumbers,
  PENDING_TTL_MINUTES,
  pinForOrganization,
  scrubSecret,
  servingTerminals,
  terminalServesRegister,
  TERMINAL_FRESH_MINUTES,
  timeoutTransition,
  type CommandState,
  type TerminalView,
} from "./rules";

const NOW = new Date("2026-11-11T10:00:00Z");
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000);
const ahead = (sec: number) => new Date(NOW.getTime() + sec * 1000);

function cmd(over: Partial<CommandState> = {}): CommandState {
  return { status: "pending", finishedBy: null, claimedBy: null, leaseUntil: null, createdAt: ago(10), ...over };
}

describe("токены", () => {
  it("токен уникален и с префиксом, хэш детерминирован и не равен токену", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.startsWith("pst_")).toBe(true);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(a);
    expect(hashToken(a)).toHaveLength(64);
  });

  it("bearerToken разбирает заголовок", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer abc")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken("Bearer")).toBeNull();
    expect(bearerToken("Bearer a b")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

describe("PIN по организации", () => {
  const raw = JSON.stringify({ "org-a": "1111", "org-b": "2222" });

  it("берёт PIN своей организации и не путает бренды", () => {
    expect(pinForOrganization(raw, "org-a")).toBe("1111");
    expect(pinForOrganization(raw, "org-b")).toBe("2222");
  });

  it("нет записи, пусто, битый JSON, не строка - null", () => {
    expect(pinForOrganization(raw, "org-c")).toBeNull();
    expect(pinForOrganization(undefined, "org-a")).toBeNull();
    expect(pinForOrganization("", "org-a")).toBeNull();
    expect(pinForOrganization("{oops", "org-a")).toBeNull();
    expect(pinForOrganization(JSON.stringify({ "org-a": 1111 }), "org-a")).toBeNull();
    expect(pinForOrganization(JSON.stringify({ "org-a": "" }), "org-a")).toBeNull();
  });
});

describe("PIN в тексте", () => {
  it("затирается везде, пустой секрет и пустой текст не ломают", () => {
    expect(scrubSecret("PIN 1234 неверен, 1234", "1234")).toBe("PIN *** неверен, ***");
    expect(scrubSecret("текст", null)).toBe("текст");
    expect(scrubSecret(null, "1234")).toBeNull();
    expect(scrubSecret(undefined, "1234")).toBeNull();
  });
});

describe("привязка к станции iikoFront", () => {
  it("первый раз запоминаем, потом сверяем без учёта регистра", () => {
    expect(identityDecision(null, "AAA")).toBe("pin");
    expect(identityDecision("aaa", "AAA")).toBe("ok");
    expect(identityDecision("aaa", "bbb")).toBe("mismatch");
  });

  it("номера касс: дубли и мусор убираются", () => {
    expect(normalizeRegisterNumbers([15, 3000, 15, -1, 2.5, 0])).toEqual([0, 15, 3000]);
  });
});

describe("таймауты команды", () => {
  it("свежая pending не трогаем, старая протухает", () => {
    expect(timeoutTransition(cmd({ createdAt: ago(60) }), NOW)).toBeNull();
    expect(timeoutTransition(cmd({ createdAt: ago(PENDING_TTL_MINUTES * 60 + 1) }), NOW)).toEqual({ status: "expired" });
  });

  it("claimed в пределах аренды не трогаем", () => {
    expect(timeoutTransition(cmd({ status: "claimed", claimedBy: "t1", leaseUntil: ahead(30) }), NOW)).toBeNull();
  });

  it("claimed с истёкшей арендой уходит в unknown/timeout, а не возвращается в pending", () => {
    const r = timeoutTransition(cmd({ status: "claimed", claimedBy: "t1", leaseUntil: ago(1) }), NOW);
    expect(r).toMatchObject({ status: "unknown", finishedBy: "timeout" });
    expect(r && "message" in r && r.message.length > 0).toBe(true);
  });

  it("итоговые статусы не меняются по времени", () => {
    for (const status of ["done", "failed", "unknown", "rejected", "dry_run_ok", "expired"]) {
      expect(timeoutTransition(cmd({ status, createdAt: ago(99999), leaseUntil: ago(99999) }), NOW)).toBeNull();
    }
  });

  it("аренда - 2 минуты", () => {
    expect(LEASE_SECONDS).toBe(120);
  });
});

describe("решение по отчёту плагина", () => {
  const claimed = cmd({ status: "claimed", claimedBy: "t1", leaseUntil: ahead(60) });

  it("терминал, забравший команду, отчитывается", () => {
    expect(decideReport(claimed, "t1")).toBe("accept");
  });

  it("чужой терминал и невзятая команда - forbidden", () => {
    expect(decideReport(claimed, "t2")).toBe("forbidden");
    expect(decideReport(cmd(), "t1")).toBe("forbidden");
    expect(decideReport(cmd({ status: "expired" }), "t1")).toBe("forbidden");
  });

  it("итог от плагина уже есть - 409 (повтор доставки)", () => {
    for (const status of ["done", "failed", "rejected", "dry_run_ok", "unknown"]) {
      expect(decideReport(cmd({ status, finishedBy: "plugin", claimedBy: "t1" }), "t1")).toBe("conflict");
    }
  });

  it("поздний отчёт после таймаута принимается, чтобы реальный done не потерялся", () => {
    const late = cmd({ status: "unknown", finishedBy: "timeout", claimedBy: "t1" });
    expect(decideReport(late, "t1")).toBe("accept");
    expect(decideReport(late, "t2")).toBe("forbidden");
  });

  it("аренда истекла, но таймаут ещё не отработал (claimed) - тоже принимается", () => {
    expect(decideReport(cmd({ status: "claimed", claimedBy: "t1", leaseUntil: ago(500) }), "t1")).toBe("accept");
  });
});

describe("статусы плагина", () => {
  it("известные принимаются, остальное нет", () => {
    for (const s of ["done", "dry_run_ok", "rejected", "failed", "unknown"]) expect(isPluginStatus(s)).toBe(true);
    for (const s of ["pending", "claimed", "expired", "ok", ""]) expect(isPluginStatus(s)).toBe(false);
  });
});

describe("есть ли терминал для кассы", () => {
  const t = (over = {}) => ({
    active: true,
    organizationId: "org-a",
    cashRegisterNumbers: [15],
    lastSeenAt: ago(30) as Date | null,
    ...over,
  });

  it("активный, свежий, той же организации и кассы - да", () => {
    expect(terminalServesRegister([t()], "org-a", 15, NOW)).toBe(true);
  });

  it("другой бренд с тем же номером кассы не подходит", () => {
    expect(terminalServesRegister([t({ organizationId: "org-b" })], "org-a", 15, NOW)).toBe(false);
  });

  it("выключен, давно не видели, не видели никогда, другая касса - нет", () => {
    expect(terminalServesRegister([t({ active: false })], "org-a", 15, NOW)).toBe(false);
    expect(terminalServesRegister([t({ lastSeenAt: ago(TERMINAL_FRESH_MINUTES * 60 + 1) })], "org-a", 15, NOW)).toBe(false);
    expect(terminalServesRegister([t({ lastSeenAt: null })], "org-a", 15, NOW)).toBe(false);
    expect(terminalServesRegister([t()], "org-a", 16, NOW)).toBe(false);
  });
});

describe("отмена команды админом", () => {
  it("pending отменяется свободно", () => {
    expect(cancelDecision("pending", null)).toBe("ok");
    expect(cancelDecision("pending", "")).toBe("ok");
  });

  it("failed и unknown - только с пояснением от 3 знаков", () => {
    for (const status of ["failed", "unknown"]) {
      expect(cancelDecision(status, null)).toBe("note_required");
      expect(cancelDecision(status, "  ")).toBe("note_required");
      expect(cancelDecision(status, "ок")).toBe("note_required");
      expect(cancelDecision(status, "проверил кассу: чек не возвращён")).toBe("ok");
    }
  });

  it("claimed (плагин может выполнять прямо сейчас) и итоговые статусы не отменяются", () => {
    for (const status of ["claimed", "done", "rejected", "dry_run_ok", "expired", "cancelled"]) {
      expect(cancelDecision(status, "причина есть")).toBe("forbidden");
    }
  });
});

describe("обрезка сообщения", () => {
  it("длинное режется, короткое и null не трогаем", () => {
    expect(clip("x".repeat(10_000), 2000)).toHaveLength(2000);
    expect(clip("abc", 2000)).toBe("abc");
    expect(clip(null, 10)).toBeNull();
    expect(clip(undefined, 10)).toBeNull();
  });
});

describe("обслуживающие терминалы", () => {
  it("возвращает сами терминалы и их dryRun", () => {
    const base = { active: true, organizationId: "o", cashRegisterNumbers: [3], lastSeenAt: ago(10) as Date | null };
    const rows: TerminalView[] = [{ ...base, dryRun: true }, { ...base, dryRun: false }, { ...base, active: false }];
    const list = servingTerminals(rows, "o", 3, NOW);
    expect(list.map((x) => x.dryRun)).toEqual([true, false]);
  });
});
