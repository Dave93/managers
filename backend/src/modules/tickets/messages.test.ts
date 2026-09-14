import { describe, expect, it } from "bun:test";
import { buildMessage, type MessageInput } from "./messages";

const base: MessageInput = {
  eventType: "created",
  lang: "ru",
  ticket: {
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    number: "TV-000123",
    priority: "urgent",
    terminal_name: "Чорсу",
    type_name_ru: "Реклама ТВ",
    type_name_uz: "Reklama TV",
    summary_ru: "Не включается",
    summary_uz: "Yoqilmayapti",
  },
  miniappUrl: "https://api.office.lesailes.uz/tickets-app/",
};

describe("buildMessage", () => {
  it("новая срочная заявка: номер, филиал, тип и кнопка", () => {
    const m = buildMessage(base);
    expect(m.text).toContain("TV-000123");
    expect(m.text).toContain("Чорсу");
    expect(m.text).toContain("Реклама ТВ");
    expect(m.text).toContain("Срочная");
    expect(m.reply_markup).toBeDefined();
    const button = (m.reply_markup as any).inline_keyboard[0][0];
    expect(button.web_app.url).toContain("?ticket=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("обычная заявка не называется срочной", () => {
    const m = buildMessage({ ...base, ticket: { ...base.ticket, priority: "normal" } });
    expect(m.text).not.toContain("Срочная");
  });

  it("узбекская локаль берёт узбекские подписи", () => {
    const m = buildMessage({ ...base, lang: "uz" });
    expect(m.text).toContain("Reklama TV");
    expect(m.text).toContain("Yoqilmayapti");
    expect(m.text).not.toContain("Реклама ТВ");
  });

  it("неизвестный язык падает на русский", () => {
    const m = buildMessage({ ...base, lang: "en" });
    expect(m.text).toContain("Реклама ТВ");
  });

  it("гашение кнопки: текст без кнопки и с именем взявшего", () => {
    const m = buildMessage({
      ...base,
      eventType: "assigned_other",
      takenBy: "Азиз",
      takenAt: "14:32",
    });
    expect(m.reply_markup).toBeUndefined();
    expect(m.text).toContain("Азиз");
    expect(m.text).toContain("14:32");
  });

  it("подтверждение взявшему содержит кнопку", () => {
    const m = buildMessage({ ...base, eventType: "assigned_taker" });
    expect(m.reply_markup).toBeDefined();
  });

  it("возврат в работу несёт комментарий менеджера", () => {
    const m = buildMessage({ ...base, eventType: "reopened", comment: "Экран всё ещё чёрный" });
    expect(m.text).toContain("Экран всё ещё чёрный");
    expect(m.reply_markup).toBeDefined();
  });

  it("комментарий менеджера уходит с текстом комментария", () => {
    const m = buildMessage({ ...base, eventType: "comment", comment: "Какой из трёх телевизоров?" });
    expect(m.text).toContain("Какой из трёх телевизоров?");
  });

  it("закрытие благодарит и кнопку не даёт", () => {
    const m = buildMessage({ ...base, eventType: "closed" });
    expect(m.reply_markup).toBeUndefined();
    expect(m.text).toContain("TV-000123");
  });

  it("отмена сообщает, что ехать не надо", () => {
    const m = buildMessage({ ...base, eventType: "cancelled" });
    expect(m.reply_markup).toBeUndefined();
  });

  it("слишком длинный комментарий обрезается по границе телеграма", () => {
    const m = buildMessage({ ...base, eventType: "comment", comment: "я".repeat(5000) });
    expect(m.text.length).toBeLessThanOrEqual(4096);
  });

  it("разметка не ломается на символах HTML", () => {
    const m = buildMessage({ ...base, eventType: "comment", comment: "<b>жирный</b> & <i>" });
    expect(m.text).toContain("&lt;b&gt;");
    expect(m.text).toContain("&amp;");
  });
});
