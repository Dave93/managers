import { describe, expect, it } from "bun:test";
import { buildNotificationRows } from "./notify";

const recipients = [
  { executor_id: "e1", chat_id: 111, lang: "ru", kind: "send" as const },
  { executor_id: "e2", chat_id: 222, lang: "uz", kind: "edit" as const, target_message_id: 900 },
];

describe("buildNotificationRows", () => {
  it("строит строку на получателя с привязкой к событию", () => {
    const rows = buildNotificationRows("ev1", recipients);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      event_id: "ev1",
      recipient_executor_id: "e1",
      recipient_chat_id: 111,
      kind: "send",
      status: "pending",
    });
    expect(rows[1]).toMatchObject({ kind: "edit", target_message_id: 900 });
  });

  it("пустой список получателей даёт пустой список строк", () => {
    expect(buildNotificationRows("ev1", [])).toEqual([]);
  });

  it("дубликат получателя с тем же видом схлопывается", () => {
    const rows = buildNotificationRows("ev1", [recipients[0], { ...recipients[0] }]);
    expect(rows).toHaveLength(1);
  });

  it("один и тот же чат с разными видами остаётся двумя строками", () => {
    const rows = buildNotificationRows("ev1", [
      { executor_id: "e1", chat_id: 111, lang: "ru", kind: "send" },
      { executor_id: "e1", chat_id: 111, lang: "ru", kind: "edit", target_message_id: 5 },
    ]);
    expect(rows).toHaveLength(2);
  });
});
