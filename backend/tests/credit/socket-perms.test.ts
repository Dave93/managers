import { describe, test, expect, afterEach } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startInternalCreditApp, resolveGroupGid } from "../../src/modules/credit/internal-app";

// No DB: the routes only touch `db` per request, and nothing here makes one.
const stubDb = {} as any;
const SETGID = 0o2000;

let tmp: string[] = [];
let servers: any[] = [];
const savedEnv = process.env.CREDIT_SOCKET_GROUP;

function runDir(mode: number) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "credit-perms-"));
  tmp.push(base);
  const dir = path.join(base, "run");
  fs.mkdirSync(dir);
  fs.chmodSync(dir, mode);
  return { dir, sock: path.join(dir, "credit-internal.sock") };
}

function start(sock: string) {
  const app = startInternalCreditApp(stubDb, sock);
  servers.push(app);
  return app;
}

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

  test("CREDIT_SOCKET_GROUP (numeric gid) sets the socket group", () => {
    const gid = process.getgid!();
    process.env.CREDIT_SOCKET_GROUP = String(gid);
    const { sock } = runDir(0o2750);
    try {
      start(sock);
    } catch (e: any) {
      if (e?.code === "EPERM") return; // chown to this group not permitted here
      throw e;
    }
    const st = fs.statSync(sock);
    expect(st.gid).toBe(gid);
    expect(st.mode & 0o777).toBe(0o660);
  });

  test("unknown group name fails loudly and creates no socket", () => {
    process.env.CREDIT_SOCKET_GROUP = "no-such-group-credit-sock-xyz";
    const { sock } = runDir(0o2750);
    expect(() => start(sock)).toThrow(/CREDIT_SOCKET_GROUP.*unknown group/);
    expect(fs.existsSync(sock)).toBe(false);
  });

  test("resolveGroupGid: numeric id and a name from /etc/group", () => {
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
});
