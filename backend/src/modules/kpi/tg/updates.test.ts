import { describe, expect, it } from "bun:test";
import { parseUpdate, secretOk } from "./updates";

const TOKEN = "0123456789abcdef0123456789abcdef";
const UUID = "11111111-2222-3333-4444-555555555555";
const msg = (text: unknown, chat: object = { id: 501, type: "private" }, from: object = { id: 501, is_bot: false }) =>
  ({ update_id: 1, message: { message_id: 7, chat, from, text } });
const cb = (data: string, type = "private") =>
  ({ update_id: 2, callback_query: { id: "cb1", from: { id: 501, is_bot: false }, data, message: { message_id: 8, chat: { id: 501, type } } } });
const ids = { chatId: 501, fromId: 501 };

describe("parseUpdate", () => {
  it("/start", () => {
    expect(parseUpdate(msg(`/start kpi_${TOKEN}`))).toEqual({ type: "start", ...ids, token: TOKEN, hasPayload: true });
    expect(parseUpdate(msg("/start kpi_XYZ"))).toEqual({ type: "start", ...ids, token: null, hasPayload: true });
    expect(parseUpdate(msg(`/start inv_${TOKEN}`))).toEqual({ type: "start", ...ids, token: null, hasPayload: true });
    expect(parseUpdate(msg("/start"))).toEqual({ type: "start", ...ids, token: null, hasPayload: false });
  });
  it("команды и текст", () => {
    expect(parseUpdate(msg("/my"))).toEqual({ type: "my", ...ids });
    expect(parseUpdate(msg("/my@kpi_test_bot"))).toEqual({ type: "my", ...ids });
    expect(parseUpdate(msg("/help"))).toEqual({ type: "help", ...ids });
    expect(parseUpdate(msg("  не согласен  "))).toEqual({ type: "text", ...ids, text: "не согласен" });
  });
  it("кнопки", () => {
    expect(parseUpdate(cb("lang:uz"))).toEqual({ type: "callback", ...ids, callbackId: "cb1", action: { kind: "lang", lang: "uz" } });
    expect(parseUpdate(cb(`dispute:violation:${UUID}`))).toEqual({ type: "callback", ...ids, callbackId: "cb1", action: { kind: "dispute", subject_type: "violation", subject_id: UUID } });
    expect((parseUpdate(cb("dispute:review:not-a-uuid")) as any).action).toEqual({ kind: "unknown" });
    expect((parseUpdate(cb("lang:en")) as any).action).toEqual({ kind: "unknown" });
  });
  it("группа, канал, бот, правка, фото, мусор — ignore", () => {
    for (const u of [
      msg("/my", { id: -100, type: "group" }), msg("/my", { id: -100, type: "supergroup" }), cb("lang:ru", "group"),
      msg("/my", { id: 501, type: "private" }, { id: 501, is_bot: true }), msg(undefined),
      { update_id: 3, edited_message: msg("/my").message }, { update_id: 4, channel_post: { chat: { id: -1, type: "channel" }, text: "x" } },
      null, "x", 5, [],
    ]) expect(parseUpdate(u)).toEqual({ type: "ignore" });
  });
});

describe("secretOk", () => {
  it("равенство за постоянное время", () => {
    expect(secretOk("kpi_test_secret", "kpi_test_secret")).toBe(true);
    expect(secretOk("kpi_test_secreT", "kpi_test_secret")).toBe(false);
    expect(secretOk("short", "kpi_test_secret")).toBe(false);
    expect(secretOk(undefined, "kpi_test_secret")).toBe(false);
  });
});
