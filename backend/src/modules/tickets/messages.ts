export type MessageEvent =
  | "created" | "assigned_taker" | "assigned_other"
  | "comment" | "reopened" | "closed" | "cancelled";

export type MessageInput = {
  eventType: MessageEvent;
  lang: string;
  ticket: {
    id: string;
    number: string;
    priority: "normal" | "urgent";
    terminal_name: string;
    type_name_ru: string;
    type_name_uz: string;
    summary_ru: string;
    summary_uz: string;
  };
  miniappUrl: string;
  comment?: string;
  takenBy?: string;
  takenAt?: string;
};

// Telegram рвёт сообщение длиннее 4096 символов целиком, а не хвост,
// поэтому режем сами и оставляем видимый след обрезки.
const TG_LIMIT = 4096;

const L = {
  ru: {
    urgent: "🔴 Срочная",
    normal: "🔧 Заявка",
    open: "Открыть заявку",
    taken: (who: string, at: string) => `Взял ${who}, ${at}`,
    reopened: "Работу вернули на доработку",
    closed: "Филиал принял работу. Спасибо",
    cancelled: "Заявка отменена — выезжать не нужно",
    comment: "Сообщение от филиала",
  },
  uz: {
    urgent: "🔴 Shoshilinch",
    normal: "🔧 Ariza",
    open: "Arizani ochish",
    taken: (who: string, at: string) => `${who} oldi, ${at}`,
    reopened: "Ish qayta ko'rib chiqishga qaytarildi",
    closed: "Filial ishni qabul qildi. Rahmat",
    cancelled: "Ariza bekor qilindi — borish shart emas",
    comment: "Filialdan xabar",
  },
} as const;

const pick = (lang: string) => (lang === "uz" ? L.uz : L.ru);

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const clip = (s: string): string => (s.length <= TG_LIMIT ? s : `${s.slice(0, TG_LIMIT - 1)}…`);

export function buildMessage(input: MessageInput): { text: string; reply_markup?: object } {
  const t = pick(input.lang);
  const typeName = input.lang === "uz" ? input.ticket.type_name_uz : input.ticket.type_name_ru;
  const summary = input.lang === "uz" ? input.ticket.summary_uz : input.ticket.summary_ru;
  const head = `${input.ticket.priority === "urgent" ? t.urgent : t.normal} · ${esc(typeName)}`;
  const place = `${esc(input.ticket.terminal_name)} · ${esc(input.ticket.number)}`;

  const button = {
    inline_keyboard: [[
      { text: t.open, web_app: { url: `${input.miniappUrl}?ticket=${input.ticket.id}` } },
    ]],
  };

  switch (input.eventType) {
    case "created":
    case "assigned_taker":
      return { text: clip(`${head}\n${place}\n${esc(summary)}`), reply_markup: button };

    case "assigned_other":
      return {
        text: clip(`${head}\n${place}\n${t.taken(esc(input.takenBy ?? ""), esc(input.takenAt ?? ""))}`),
      };

    case "comment":
      return {
        text: clip(`${head}\n${place}\n\n${t.comment}:\n${esc(input.comment ?? "")}`),
        reply_markup: button,
      };

    case "reopened":
      return {
        text: clip(`${head}\n${place}\n\n${t.reopened}:\n${esc(input.comment ?? "")}`),
        reply_markup: button,
      };

    case "closed":
      return { text: clip(`${head}\n${place}\n\n${t.closed}`) };

    case "cancelled":
      return { text: clip(`${head}\n${place}\n\n${t.cancelled}`) };
  }
}
