import { describe, expect, it } from "bun:test";
import { startScheduling } from "./boot";

const run = async (register: () => Promise<unknown>, catchUp: () => Promise<unknown>) => {
  const logs: string[] = [];
  const exits: number[] = [];
  let caught = 0;
  await startScheduling({
    register,
    catchUp: () => {
      caught++;
      return catchUp();
    },
    log: (m) => logs.push(m),
    exit: (c) => exits.push(c),
  });
  return { logs, exits, caught };
};

describe("startScheduling", () => {
  it("регистрация прошла — догоняем, выхода нет", async () => {
    expect(await run(async () => {}, async () => {})).toEqual({ logs: [], exits: [], caught: 1 });
  });
  it("регистрация упала — лог и exit(1), догонялка не запускается", async () => {
    const r = await run(async () => { throw new Error("redis down"); }, async () => {});
    expect(r.exits).toEqual([1]);
    expect(r.logs).toHaveLength(1);
    expect(r.caught).toBe(0);
  });
  it("догонялка упала — только лог, без выхода", async () => {
    const r = await run(async () => {}, async () => { throw new Error("db"); });
    expect(r.exits).toEqual([]);
    expect(r.logs).toHaveLength(1);
  });
});
