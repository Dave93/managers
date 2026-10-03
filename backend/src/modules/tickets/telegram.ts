export type TgResult =
  | { ok: true; message_id: number | null }
  | { ok: false; retryAfterMs?: number; permanent: boolean; error: string };

// Разбор ответа вынесен отдельно от сети: это единственная часть, где
// принимается решение «ретраить или списать», и её надо проверять тестами,
// а не живым Telegram.
export function interpretResponse(status: number, body: any): TgResult {
  if (status === 200 && body?.ok === true) {
    return { ok: true, message_id: body.result?.message_id ?? null };
  }

  const description: string = body?.description ?? `http ${status}`;

  // Гашение кнопки у сообщения, которое уже без кнопки, телеграм считает
  // ошибкой. Для нас цель достигнута. Telegram не возвращает message_id в
  // этом ответе, поэтому отдаём null, а не 0 — 0 не валидный id сообщения,
  // но выглядит как обычное число, и вызывающий код может по ошибке
  // сохранить его как tg_message_id, затерев настоящий id. null явно
  // говорит: «id не пришёл, оставь то, что уже сохранено».
  if (status === 400 && description.includes("message is not modified")) {
    return { ok: true, message_id: null };
  }

  if (status === 429) {
    const retryAfter = body?.parameters?.retry_after;
    return {
      ok: false,
      permanent: false,
      retryAfterMs: typeof retryAfter === "number" ? retryAfter * 1000 : undefined,
      error: description,
    };
  }

  // Пользователь заблокировал бота, чата нет, бот выкинут из чата — сколько
  // ни повторяй, ответ не изменится. Три нижних — тот же класс, но на
  // edit-пути: сообщение старше 48-часового окна правки Telegram, само
  // сообщение удалено, или его id вообще не существует. Без них такие ответы
  // классифицировались как временные — пять бесполезных ретраев, а затем
  // находка #1 (строка остаётся в 'pending' навсегда после исчерпания
  // попыток, а не переходит в 'failed').
  const permanentMarks = [
    "bot was blocked",
    "chat not found",
    "user is deactivated",
    "bot was kicked",
    "have no rights",
    "message to edit not found",
    "message can't be edited",
    "MESSAGE_ID_INVALID",
  ];
  const permanent =
    (status === 400 || status === 403) && permanentMarks.some((m) => description.includes(m));

  return { ok: false, permanent, error: description };
}

async function call(token: string, method: string, payload: object): Promise<TgResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return interpretResponse(res.status, body);
  } catch (e) {
    // Сеть легла — временная ошибка, пусть очередь повторит.
    return { ok: false, permanent: false, error: (e as Error).message };
  }
}

export function sendMessage(
  token: string,
  chatId: number,
  payload: { text: string; reply_markup?: object }
): Promise<TgResult> {
  return call(token, "sendMessage", {
    chat_id: chatId,
    text: payload.text,
    parse_mode: "HTML",
    reply_markup: payload.reply_markup,
    disable_web_page_preview: true,
  });
}

export function editMessageText(
  token: string,
  chatId: number,
  messageId: number,
  payload: { text: string; reply_markup?: object }
): Promise<TgResult> {
  return call(token, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: payload.text,
    parse_mode: "HTML",
    reply_markup: payload.reply_markup,
  });
}
