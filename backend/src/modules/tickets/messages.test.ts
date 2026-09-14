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
    expect(m.text).toContain("Заявка");
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

  it("assigned_taker содержит подтверждение и кнопку", () => {
    const m = buildMessage({ ...base, eventType: "assigned_taker" });
    expect(m.text).toContain("✅ Вы взяли заявку");
    expect(m.text).toContain("Реклама ТВ");
    expect(m.reply_markup).toBeDefined();
  });

  it("assigned_taker узбекский имеет подтверждение", () => {
    const m = buildMessage({ ...base, eventType: "assigned_taker", lang: "uz" });
    expect(m.text).toContain("✅ Siz arizani oldingiz");
    expect(m.text).toContain("Reklama TV");
    expect(m.reply_markup).toBeDefined();
  });

  it("assigned_other с обоими полями: имя и время", () => {
    const m = buildMessage({
      ...base,
      eventType: "assigned_other",
      takenBy: "Азиз",
      takenAt: "14:32",
    });
    expect(m.reply_markup).toBeUndefined();
    expect(m.text).toContain("Взял Азиз, 14:32");
  });

  it("assigned_other без имени: не показывает пустое имя", () => {
    const m = buildMessage({
      ...base,
      eventType: "assigned_other",
      takenAt: "14:32",
    });
    expect(m.reply_markup).toBeUndefined();
    expect(m.text).toContain("Заявку уже взяли");
    expect(m.text).not.toContain(", 14:32");
  });

  it("assigned_other без времени: показывает только имя", () => {
    const m = buildMessage({
      ...base,
      eventType: "assigned_other",
      takenBy: "Азиз",
    });
    expect(m.reply_markup).toBeUndefined();
    expect(m.text).toContain("Взял Азиз");
    expect(m.text).not.toContain(", ");
  });

  it("assigned_other без обоих полей: сообщает что заявка уже взята", () => {
    const m = buildMessage({
      ...base,
      eventType: "assigned_other",
    });
    expect(m.reply_markup).toBeUndefined();
    expect(m.text).toContain("Заявку уже взяли");
  });

  it("assigned_other узбекский без имени", () => {
    const m = buildMessage({
      ...base,
      eventType: "assigned_other",
      lang: "uz",
      takenAt: "14:32",
    });
    expect(m.text).toContain("Ariza allaqachon olingan");
  });

  it("comment с текстом менеджера и кнопкой", () => {
    const m = buildMessage({
      ...base,
      eventType: "comment",
      comment: "Какой из трёх телевизоров?",
    });
    expect(m.text).toContain("Какой из трёх телевизоров?");
    expect(m.text).toContain("Сообщение от филиала");
    expect(m.reply_markup).toBeDefined();
  });

  it("comment без текста: не показывает пустой раздел", () => {
    const m = buildMessage({
      ...base,
      eventType: "comment",
    });
    expect(m.text).not.toContain("Сообщение от филиала:");
    expect(m.reply_markup).toBeDefined();
  });

  it("comment узбекский", () => {
    const m = buildMessage({
      ...base,
      eventType: "comment",
      lang: "uz",
      comment: "Qaysi TV?",
    });
    expect(m.text).toContain("Qaysi TV?");
    expect(m.text).toContain("Filialdan xabar");
  });

  it("reopened с комментарием и кнопкой", () => {
    const m = buildMessage({
      ...base,
      eventType: "reopened",
      comment: "Экран всё ещё чёрный",
    });
    expect(m.text).toContain("Экран всё ещё чёрный");
    expect(m.text).toContain("Работу вернули на доработку");
    expect(m.reply_markup).toBeDefined();
  });

  it("reopened без комментария: не показывает пустой раздел", () => {
    const m = buildMessage({
      ...base,
      eventType: "reopened",
    });
    expect(m.text).toContain("Работу вернули на доработку");
    expect(m.text).not.toContain(":");
    expect(m.reply_markup).toBeDefined();
  });

  it("reopened узбекский с комментарием", () => {
    const m = buildMessage({
      ...base,
      eventType: "reopened",
      lang: "uz",
      comment: "Displey hali qora",
    });
    expect(m.text).toContain("Displey hali qora");
    expect(m.text).toContain("Ish qayta ko'rib chiqishga qaytarildi");
  });

  it("closed благодарит и не даёт кнопку", () => {
    const m = buildMessage({ ...base, eventType: "closed" });
    expect(m.reply_markup).toBeUndefined();
    expect(m.text).toContain("Филиал принял работу. Спасибо");
    expect(m.text).toContain("TV-000123");
  });

  it("closed узбекский", () => {
    const m = buildMessage({ ...base, eventType: "closed", lang: "uz" });
    expect(m.reply_markup).toBeUndefined();
    expect(m.text).toContain("Filial ishni qabul qildi. Rahmat");
  });

  it("отмена сообщает, что ехать не надо", () => {
    const m = buildMessage({ ...base, eventType: "cancelled" });
    expect(m.reply_markup).toBeUndefined();
    expect(m.text).toContain("Заявка отменена — выезжать не нужно");
    expect(m.text).toContain("TV-000123");
  });

  it("cancelled узбекский", () => {
    const m = buildMessage({ ...base, eventType: "cancelled", lang: "uz" });
    expect(m.reply_markup).toBeUndefined();
    expect(m.text).toContain("Ariza bekor qilindi — borish shart emas");
  });

  it("разметка не ломается на символах HTML", () => {
    const m = buildMessage({
      ...base,
      eventType: "comment",
      comment: "<b>жирный</b> & <i>italic</i>",
    });
    expect(m.text).toContain("&lt;b&gt;");
    expect(m.text).toContain("&amp;");
    expect(m.text).toContain("&lt;/i&gt;");
  });

  it("слишком длинный комментарий обрезается по границе телеграма", () => {
    const m = buildMessage({
      ...base,
      eventType: "comment",
      comment: "я".repeat(5000),
    });
    expect(m.text.length).toBeLessThanOrEqual(4096);
    expect(m.text).toContain("…");
  });

  it("отсутствующее terminal_name не крашит", () => {
    const m = buildMessage({
      ...base,
      ticket: { ...base.ticket, terminal_name: undefined as any },
    });
    expect(m.text).toBeDefined();
    expect(m.text.length).toBeGreaterThan(0);
  });

  it("null в comment безопасно", () => {
    const m = buildMessage({
      ...base,
      eventType: "comment",
      comment: null as any,
    });
    expect(m.text).toBeDefined();
    expect(m.text.length).toBeGreaterThan(0);
  });

  it("emoji в границе 4096 не разрезает суррогатную пару", () => {
    const longPrefix = "х".repeat(4090);
    const emojiString = "😀";
    const m = buildMessage({
      ...base,
      eventType: "comment",
      comment: longPrefix + emojiString,
    });
    expect(m.text.length).toBeLessThanOrEqual(4096);
    expect(m.text).toContain("…");
  });
});
