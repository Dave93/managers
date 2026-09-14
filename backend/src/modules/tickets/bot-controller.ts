import { ctx } from "@backend/context";
import { ticket_contractors, ticket_executors } from "backend/drizzle/schema";
import { and, eq, isNull } from "drizzle-orm";
import Elysia, { t } from "elysia";
import { sendMessage } from "./telegram";
import { UUID_RE } from "./storage";

// Разбор payload deep-link'а телеграм-бота: "/start inv_<uuid>" → сам uuid,
// всё остальное — null. Чистая функция без сети и базы, чтобы гонять её
// тестами без поднятия сервера — единственная часть этого роута, которую
// вообще можно проверить так.
export function parseStartPayload(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const m = text.trim().match(/^\/start\s+inv_([0-9a-fA-F-]{36})$/);
  if (!m) return null;
  return UUID_RE.test(m[1]) ? m[1] : null;
}

// Единственный публичный роут подсистемы. Пускает только телеграм, знающий
// секрет; всё остальное получает 200 и игнорируется, чтобы телеграм не копил
// повторы (не-2xx ответ Telegram расценивает как временный сбой и ретраит
// апдейт бесконечно).
export const ticketsBotController = new Elysia({ name: "@api/tickets-bot" })
  .use(ctx)
  .post(
    "/tickets/bot/webhook",
    async ({ headers, body, drizzle, set }) => {
      const secret = process.env.TICKETS_BOT_WEBHOOK_SECRET;
      if (!secret) {
        console.error("tickets bot: TICKETS_BOT_WEBHOOK_SECRET не задан");
        set.status = 500;
        return { ok: false };
      }
      // Секрет проверяется раньше любого разбора тела — чужой запрос без
      // заголовка или с неверным значением не должен доходить даже до
      // JSON.parse. Ответ одинаковый и для отсутствующего, и для неверного
      // секрета: раскрывать разницу незачем.
      if (headers["x-telegram-bot-api-secret-token"] !== secret) {
        set.status = 401;
        return { ok: false };
      }

      // Апдейт может быть чем угодно: channel_post, edited_message, апдейт
      // без from (добавление бота в канал) — всё, что не message.text с
      // разобранным кодом, тихо подтверждается 200 и не идёт дальше.
      const message = (body as any)?.message;
      const code = parseStartPayload(message?.text);
      const chatId = message?.chat?.id;
      const fromId = message?.from?.id;
      if (!code || typeof chatId !== "number" || typeof fromId !== "number") {
        return { ok: true };
      }

      const token = process.env.TICKETS_BOT_TOKEN ?? "";

      // Инвайт одноразовый: UPDATE матчит одновременно на invite_code И на
      // invite_used_at IS NULL, так что повторная доставка того же апдейта
      // телеграмом (он ретраит) или пересланная ссылка второй раз не
      // перепривязывают исполнителя — вторая попытка просто не находит строк.
      const bound = await drizzle
        .update(ticket_executors)
        .set({
          tg_user_id: fromId,
          invite_used_at: new Date().toISOString(),
          lang: message?.from?.language_code === "uz" ? "uz" : "ru",
          updated_at: new Date().toISOString(),
        })
        .where(and(eq(ticket_executors.invite_code, code), isNull(ticket_executors.invite_used_at)))
        .returning({ id: ticket_executors.id, full_name: ticket_executors.full_name, contractor_id: ticket_executors.contractor_id })
        .execute();

      if (bound.length === 0) {
        // Не сообщаем, был ли код вообще, использован ли уже, чей он —
        // ответ одинаковый на любую причину отказа.
        if (token) await sendMessage(token, chatId, { text: "Ссылка недействительна или уже использована. Попросите новую." });
        return { ok: true };
      }

      const [contractor] = bound[0].contractor_id
        ? await drizzle.select({ name: ticket_contractors.name }).from(ticket_contractors).where(eq(ticket_contractors.id, bound[0].contractor_id)).execute()
        : [];

      if (token) {
        await sendMessage(token, chatId, {
          text: `Вы добавлены как исполнитель${contractor?.name ? `, фирма «${contractor.name}»` : ""}. Заявки будут приходить сюда.`,
        });
      }
      return { ok: true };
    },
    { body: t.Any() }
  );
