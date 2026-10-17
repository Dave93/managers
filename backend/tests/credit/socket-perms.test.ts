import { describe, test, expect, afterEach, spyOn } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  startInternalCreditApp,
  resolveGroupGid,
  assertDedicatedSocketDir,
} from "../../src/modules/credit/internal-app";

// No DB: the routes only touch `db` per request, and nothing here makes one.
const stubDb = {} as any;
const SETGID = 0o2000;

let tmp: string[] = [];
let servers: any[] = [];
const savedEnv = process.env.CREDIT_SOCKET_GROUP;

function mkBase() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "credit-perms-"));
  tmp.push(base);
  return base;
}

function runDir(mode: number) {
  const dir = path.join(mkBase(), "run");
  fs.mkdirSync(dir);
  fs.chmodSync(dir, mode);
  return { dir, sock: path.join(dir, "credit-internal.sock") };
}

function start(sock: string) {
  const app = startInternalCreditApp(stubDb, sock);
  servers.push(app);
  return app;
}

// A group this process belongs to that differs from the one new dirs get, so a
// missing chown cannot pass by accident.
const probe = mkBase();
// Root may chown to any gid, and its own group list is just [0].
const alt =
  process.getgroups?.().find((g) => g !== fs.statSync(probe).gid) ??
  (process.geteuid?.() === 0 ? 65534 : undefined);

afterEach(async () => {
  for (const s of servers) await s.stop(true);
  servers = [];
  for (const d of tmp) fs.rmSync(d, { recursive: true, force: true });
  tmp = [];
  if (savedEnv === undefined) delete process.env.CREDIT_SOCKET_GROUP;
  else process.env.CREDIT_SOCKET_GROUP = savedEnv;
});

describe("credit internal socket permissions", () => {
  test("setgid survives start; dir 2750, socket 0660", () => {
    delete process.env.CREDIT_SOCKET_GROUP;
    const { dir, sock } = runDir(0o2750);
    start(sock);
    const d = fs.statSync(dir).mode;
    expect(d & SETGID).toBe(SETGID);
    expect(d & 0o7777).toBe(0o2750);
    expect(fs.statSync(sock).mode & 0o777).toBe(0o660);
  });

  test("a wider pre-existing dir is narrowed back to 2750", () => {
    delete process.env.CREDIT_SOCKET_GROUP;
    const { dir, sock } = runDir(0o755);
    start(sock);
    expect(fs.statSync(dir).mode & 0o7777).toBe(0o2750);
  });

  test.skipIf(alt === undefined)("CREDIT_SOCKET_GROUP (numeric gid) sets the group of dir and socket", () => {
    process.env.CREDIT_SOCKET_GROUP = String(alt);
    const { dir, sock } = runDir(0o2750);
    expect(fs.statSync(dir).gid).not.toBe(alt);
    start(sock);
    expect(fs.statSync(sock).gid).toBe(alt!);
    expect(fs.statSync(dir).gid).toBe(alt!);
    expect(fs.statSync(sock).mode & 0o777).toBe(0o660);
    expect(fs.statSync(dir).mode & 0o7777).toBe(0o2750);
  });

  test("unknown group name: logs loudly and still serves, without the chown", () => {
    process.env.CREDIT_SOCKET_GROUP = "no-such-group-credit-sock-xyz";
    const err = spyOn(console, "error").mockImplementation(() => {});
    try {
      const { sock } = runDir(0o2750);
      const gidBefore = fs.statSync(path.dirname(sock)).gid;
      start(sock);
      expect(fs.statSync(sock).mode & 0o777).toBe(0o660);
      expect(fs.statSync(sock).gid).toBe(gidBefore);
      const logged = err.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toMatch(/CREDIT_SOCKET_GROUP.*unknown group.*WITHOUT the group chown/);
    } finally {
      err.mockRestore();
    }
  });

  test("a failure after listen unlinks the socket and rethrows", () => {
    delete process.env.CREDIT_SOCKET_GROUP;
    const { sock } = runDir(0o2750);
    const real = fs.chmodSync;
    const spy = spyOn(fs, "chmodSync").mockImplementation(((p: any, m: any) => {
      if (String(p) === sock) throw Object.assign(new Error("boom"), { code: "EPERM" });
      return real(p, m);
    }) as any);
    try {
      expect(() => startInternalCreditApp(stubDb, sock)).toThrow(/boom/);
    } finally {
      spy.mockRestore();
    }
    expect(fs.existsSync(sock)).toBe(false);
  });
});

describe("resolveGroupGid", () => {
  test("numeric id and a name from /etc/group", () => {
    expect(resolveGroupGid("1234")).toBe(1234);
    let line: string | undefined;
    try {
      line = fs.readFileSync("/etc/group", "utf8").split("\n")
        .find((l) => /^[^#:][^:]*:[^:]*:\d+:/.test(l));
    } catch {}
    if (!line) return;
    const [name, , gid] = line.split(":");
    expect(resolveGroupGid(name)).toBe(Number(gid));
  });

  test("out-of-range numeric gid and unknown names throw", () => {
    expect(() => resolveGroupGid("4294967295")).toThrow(/out of range/);
    expect(() => resolveGroupGid("99999999999999999999")).toThrow(/out of range/);
    expect(() => resolveGroupGid("no-such-group-credit-sock-xyz")).toThrow(/unknown group/);
    expect(() => resolveGroupGid("--service=files")).toThrow(/unknown group/);
  });
});

describe("shared or foreign socket dir is refused before any chmod/chown", () => {
  test("sticky dir (1777) is left untouched and start throws", () => {
    const { dir, sock } = runDir(0o1777);
    expect(() => startInternalCreditApp(stubDb, sock)).toThrow(/refused/);
    expect(fs.statSync(dir).mode & 0o7777).toBe(0o1777);
    expect(fs.existsSync(sock)).toBe(false);
  });

  test("world-writable dir (0777) is left untouched and start throws", () => {
    const { dir, sock } = runDir(0o777);
    expect(() => startInternalCreditApp(stubDb, sock)).toThrow(/world-writable/);
    expect(fs.statSync(dir).mode & 0o7777).toBe(0o777);
  });

  test("symlinked dir is refused and its target is untouched", () => {
    const base = mkBase();
    const target = path.join(base, "target");
    fs.mkdirSync(target);
    fs.chmodSync(target, 0o755);
    const link = path.join(base, "link");
    fs.symlinkSync(target, link);
    expect(() => startInternalCreditApp(stubDb, path.join(link, "s.sock"))).toThrow(/symlink/);
    expect(fs.statSync(target).mode & 0o7777).toBe(0o755);
  });

  test("dir owned by someone else is refused", () => {
    const { dir } = runDir(0o2750);
    const euid = process.geteuid!();
    expect(() => assertDedicatedSocketDir(dir, euid + 1)).toThrow(/owned by uid/);
    expect(() => assertDedicatedSocketDir(dir, euid)).not.toThrow();
  });

  test("trailing slash cannot slip a symlink past the guard", () => {
    const base = mkBase();
    const target = path.join(base, "target");
    fs.mkdirSync(target);
    fs.chmodSync(target, 0o755);
    const link = path.join(base, "link");
    fs.symlinkSync(target, link);
    expect(() => startInternalCreditApp(stubDb, `${link}//s.sock`)).toThrow(/symlink/);
    expect(() => startInternalCreditApp(stubDb, `${link}/s.sock`)).toThrow(/symlink/);
    expect(fs.statSync(target).mode & 0o7777).toBe(0o755);
  });

  test("0755 dir holding foreign entries is refused and left at 0755 (a /run-like dir)", () => {
    const { dir, sock } = runDir(0o755);
    fs.writeFileSync(path.join(dir, "mysqld.pid"), "1");
    expect(() => startInternalCreditApp(stubDb, sock)).toThrow(/entries that are not ours \(mysqld.pid\)/);
    expect(fs.statSync(dir).mode & 0o7777).toBe(0o755);
    expect(fs.existsSync(sock)).toBe(false);
  });

  test("0755 dir holding only the stale socket file is still narrowed to 2750", () => {
    delete process.env.CREDIT_SOCKET_GROUP;
    const { dir, sock } = runDir(0o755);
    fs.writeFileSync(sock, "");
    start(sock);
    expect(fs.statSync(dir).mode & 0o7777).toBe(0o2750);
  });

  test("0750 dir with extra files starts (others cannot traverse, contents are not read)", () => {
    delete process.env.CREDIT_SOCKET_GROUP;
    const { dir, sock } = runDir(0o750);
    fs.writeFileSync(path.join(dir, "other.file"), "x");
    start(sock);
    expect(fs.statSync(dir).mode & 0o7777).toBe(0o2750);
  });

  test("deny list: /, /tmp, /var/tmp, os.tmpdir() (guard only, real perms untouched)", () => {
    const before = ["/tmp", "/var/tmp"].map((p) => fs.statSync(p).mode);
    for (const p of ["/", "/tmp", "/var/tmp", os.tmpdir()]) {
      expect(() => assertDedicatedSocketDir(p)).toThrow(/refused/);
    }
    expect(["/tmp", "/var/tmp"].map((p) => fs.statSync(p).mode)).toEqual(before);
  });
});
