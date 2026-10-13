import { describe, expect, it } from "bun:test";
import { isStalled, STALL_AFTER_MS } from "./worker-health";

const NOW = 1_800_000_000_000;
const old = NOW - STALL_AFTER_MS - 1;

describe("isStalled", () => {
  it("очередь пуста — не тревожим", () => {
    expect(isStalled({ oldestReadyAt: null, workers: 0, active: 0 }, NOW)).toBe(false);
  });
  it("задача ждёт меньше минуты — не тревожим", () => {
    expect(isStalled({ oldestReadyAt: NOW - 30_000, workers: 0, active: 0 }, NOW)).toBe(false);
  });
  it("ждёт больше минуты, обработчиков нет — не запущен", () => {
    expect(isStalled({ oldestReadyAt: old, workers: 0, active: 0 }, NOW)).toBe(true);
  });
  it("ждёт больше минуты, но обработчик подключён и занят — очередь, а не сбой", () => {
    expect(isStalled({ oldestReadyAt: old, workers: 1, active: 1 }, NOW)).toBe(false);
  });
  it("обработчик упал посреди задачи: задача «active», обработчиков нет", () => {
    expect(isStalled({ oldestReadyAt: old, workers: 0, active: 1 }, NOW)).toBe(true);
  });
  it("список клиентов недоступен — судим по тому, обрабатывается ли что-то", () => {
    expect(isStalled({ oldestReadyAt: old, workers: null, active: 0 }, NOW)).toBe(true);
    expect(isStalled({ oldestReadyAt: old, workers: null, active: 1 }, NOW)).toBe(false);
  });
});
