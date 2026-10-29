import { describe, expect, it } from "bun:test";
import { raisesCsv } from "./raises";
import type { RaiseRow } from "./types";

const row = (o: Partial<RaiseRow> = {}): RaiseRow => ({
  id: "r1",
  quarter_start: "2025-07-01",
  employee_id: "e1",
  employee_name: "Тест Повар",
  terminal_name: "Филиал",
  card_title: "Повар",
  months: [
    { period: "2025-07-01", score_pct: 92 },
    { period: "2025-08-01", score_pct: null },
    { period: "2025-09-01", score_pct: 94.5 },
  ],
  months_scored: 2,
  avg_pct: 93.25,
  suggested_amount: 300000,
  status: "proposed",
  approved_amount: null,
  decided_by_name: null,
  decided_at: null,
  comment: null,
  periods_closed: false,
  stale: false,
  ...o,
});

describe("raisesCsv", () => {
  it("BOM, CRLF, точная шапка", () => {
    const csv = raisesCsv([]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿ФИО;Филиал;Карта;Месяц 1;Месяц 2;Месяц 3;Средняя;Предложение;Решение;Сумма;Комментарий\r\n");
  });

  it("проценты с запятой, пустой месяц и сумма — пустые ячейки", () => {
    const lines = raisesCsv([row()]).split("\r\n");
    expect(lines[1]).toBe("Тест Повар;Филиал;Повар;92,00;;94,50;93,25;300000;предложено;;");
  });

  it("поле с ; и кавычкой экранируется, статусы по-русски", () => {
    const csv = raisesCsv([
      row({ status: "approved", approved_amount: 0, comment: 'Сказал "ок"; ждём\nещё' }),
      row({ status: "insufficient" }),
      row({ status: "rejected" }),
    ]);
    expect(csv).toContain('утверждено;0;"Сказал ""ок""; ждём\nещё"');
    expect(csv).toContain(";мало оценок;;");
    expect(csv).toContain(";отказано;;");
  });

  it('комментарий "=HYPERLINK(1)" выгружается как "\'=HYPERLINK(1)"', () => {
    const csv = raisesCsv([row({ comment: "=HYPERLINK(1)" })]);
    expect(csv).toContain(";'=HYPERLINK(1)");
    expect(csv).not.toContain(";=HYPERLINK(1)");
  });

  it("защита от формул: =, +, -, @, табуляция, \\r в строковых ячейках; числа и пустое не трогаем", () => {
    for (const bad of ["=1+1", "+7", "-2", "@SUM(A1)", "\tx", "\rx"]) {
      // Ячейка с \r берётся в кавычки целиком, остальные идут как есть.
      const cell = bad.includes("\r") ? `"'${bad}"` : `'${bad}`;
      for (const key of ["employee_name", "terminal_name", "card_title", "comment"] as const) {
        const csv = raisesCsv([row({ [key]: bad })]);
        expect(csv).toContain(cell);
        expect(csv).not.toContain(`;${bad};`);
        expect(csv.endsWith(`;${bad}\r\n`)).toBe(false);
      }
    }
    // Суммы и проценты — числа, апостроф не получают.
    const lines = raisesCsv([row({ status: "approved", approved_amount: 250000, comment: null })]).split("\r\n");
    expect(lines[1]).toBe("Тест Повар;Филиал;Повар;92,00;;94,50;93,25;300000;утверждено;250000;");
    // Безопасный текст остаётся как был.
    expect(raisesCsv([row({ comment: "Хорошо" })])).toContain(";Хорошо\r\n");
  });
});
