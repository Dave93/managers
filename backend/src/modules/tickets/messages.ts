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

type Dict = {
  urgent: string;
  normal: string;
  open: string;
  taken: (who: string, at: string) => string;
  taken_no_who: string;
  taken_no_time: (who: string) => string;
  reopened: string;
  closed: string;
  cancelled: string;
  comment: string;
  confirm_taker: string;
};

const L = {
  ru: {
    urgent: "🔴 Срочная",
    normal: "🔧 Заявка",
    open: "Открыть заявку",
    taken: (who: string, at: string) => `Взял ${who}, ${at}`,
    taken_no_who: "Заявку уже взяли",
    taken_no_time: (who: string) => `Взял ${who}`,
    reopened: "Работу вернули на доработку",
    closed: "Филиал принял работу. Спасибо",
    cancelled: "Заявка отменена — выезжать не нужно",
    comment: "Сообщение от филиала",
    confirm_taker: "✅ Вы взяли заявку",
  },
  uz: {
    urgent: "🔴 Shoshilinch",
    normal: "🔧 Ariza",
    open: "Arizani ochish",
    taken: (who: string, at: string) => `${who} oldi, ${at}`,
    taken_no_who: "Ariza allaqachon olingan",
    taken_no_time: (who: string) => `${who} oldi`,
    reopened: "Ish qayta ko'rib chiqishga qaytarildi",
    closed: "Filial ishni qabul qildi. Rahmat",
    cancelled: "Ariza bekor qilindi — borish shart emas",
    comment: "Filialdan xabar",
    confirm_taker: "✅ Siz arizani oldingiz",
  },
} as const satisfies Record<string, Dict>;

const pick = (lang: string) => (lang === "uz" ? L.uz : L.ru);

// Safely escape HTML, handle nullish and non-string inputs
const esc = (s: unknown): string => {
  if (s === null || s === undefined || typeof s !== "string") {
    return "";
  }
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

// Clip on UTF-16 code-unit boundary, respecting surrogate pairs AND HTML
// entities. `clip()` runs on text that already went through `esc()` above —
// a naive length cut can land in the middle of "&amp;"/"&lt;"/"&gt;" (e.g.
// "...&am"), and Telegram answers 400 "can't parse entities" on that with
// parse_mode: HTML.
export const clip = (s: string): string => {
  if (s.length <= TG_LIMIT) {
    return s;
  }
  // s.length counts UTF-16 code units (what Telegram counts)
  // TG_LIMIT - 1 leaves room for ellipsis
  let end = TG_LIMIT - 1;
  // Longest entity we ever produce is "&amp;" (5 chars) — scanning 5 chars
  // back from the cut is enough to tell whether it lands inside one. A ";"
  // found first means any entity before the cut is already closed.
  for (let i = end - 1; i >= Math.max(0, end - 5); i--) {
    if (s[i] === ";") break;
    if (s[i] === "&") {
      end = i;
      break;
    }
  }
  let result = s.substring(0, end);
  // Check if last char is a high surrogate (incomplete pair)
  const lastChar = result.charCodeAt(result.length - 1);
  if (lastChar >= 0xd800 && lastChar <= 0xdbff) {
    // High surrogate without low surrogate, remove it
    result = result.substring(0, result.length - 1);
  }
  return result + "…";
};

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
      return { text: clip(`${head}\n${place}\n${esc(summary)}`), reply_markup: button };

    case "assigned_taker":
      return {
        text: clip(`${t.confirm_taker}\n${head}\n${place}\n${esc(summary)}`),
        reply_markup: button,
      };

    case "assigned_other": {
      let takenLine: string;
      if (esc(input.takenBy) && esc(input.takenAt)) {
        takenLine = t.taken(esc(input.takenBy), esc(input.takenAt));
      } else if (esc(input.takenBy)) {
        takenLine = t.taken_no_time(esc(input.takenBy));
      } else {
        takenLine = t.taken_no_who;
      }
      return { text: clip(`${head}\n${place}\n${takenLine}`) };
    }

    case "comment": {
      const commentText = esc(input.comment);
      if (!commentText) {
        return { text: clip(`${head}\n${place}`), reply_markup: button };
      }
      return {
        text: clip(`${head}\n${place}\n\n${t.comment}:\n${commentText}`),
        reply_markup: button,
      };
    }

    case "reopened": {
      const commentText = esc(input.comment);
      if (!commentText) {
        return { text: clip(`${head}\n${place}\n\n${t.reopened}`), reply_markup: button };
      }
      return {
        text: clip(`${head}\n${place}\n\n${t.reopened}:\n${commentText}`),
        reply_markup: button,
      };
    }

    case "closed":
      return { text: clip(`${head}\n${place}\n\n${t.closed}`) };

    case "cancelled":
      return { text: clip(`${head}\n${place}\n\n${t.cancelled}`) };

    default:
      const _exhaustive: never = input.eventType;
      throw new Error(`buildMessage: unknown eventType "${_exhaustive}"`);
  }
}
