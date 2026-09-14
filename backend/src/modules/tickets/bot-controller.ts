import { ctx } from "@backend/context";
import { ticket_contractors, ticket_executors } from "backend/drizzle/schema";
import { and, eq, isNull } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
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

// Сравнение секрета за постоянное время: обычный !== утекает через тайминг
// длину общего префикса. Длины сравниваются отдельно и раньше —
// timingSafeEqual бросает исключение на буферах разной длины, а не отвечает
// false, так что бросать её напрямую на непроверенных данных нельзя.
function secretMatches(received: unknown, expected: string): boolean {
  if (typeof received !== "string") return false;
  const receivedBuf = Buffer.from(received);
  const expectedBuf = Buffer.from(expected);
  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}

// Единственный публичный роут подсистемы. Пускает только телеграм, знающий
// секрет; всё остальное получает 200 и игнорируется, чтобы телеграм не копил
// повторы (не-2xx ответ Telegram расценивает как временный сбой и ретраит
// апдейт бесконечно — в том числе и наши собственные сбои конфигурации или
// сети, которые повтор не чинит).
export const ticketsBotController = new Elysia({ name: "@api/tickets-bot" })
  .use(ctx)
  .post(
    "/tickets/bot/webhook",
    async ({ headers, body, drizzle, set }) => {
      const secret = process.env.TICKETS_BOT_WEBHOOK_SECRET;
      if (!secret) {
        // Не настроенный секрет — это наша ошибка конфигурации, а не что-то,
        // что повтор запроса от Telegram может исправить. Отвечаем 200 и
        // ничего не делаем, чтобы легитимные /start не копились в очередь
        // ретраев и не хлынули разом, когда переменную наконец выставят.
        // console.error остаётся: это единственный способ, которым оператор
        // узнаёт о проблеме.
        console.error("tickets bot: TICKETS_BOT_WEBHOOK_SECRET не задан");
        return { ok: true };
      }
      // Секрет проверяется раньше любого разбора тела — чужой запрос без
      // заголовка или с неверным значением не должен доходить даже до
      // JSON.parse. Ответ одинаковый и для отсутствующего, и для неверного
      // секрета: раскрывать разницу незачем. Сравнение — за постоянное
      // время: это единственная проверка доступа на всём публичном роуте.
      if (!secretMatches(headers["x-telegram-bot-api-secret-token"], secret)) {
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
      // is_active тоже в WHERE: деактивированного исполнителя неиспользованный
      // инвайт привязать не должен, кто бы ссылкой ни владел — иначе tg_user_id
      // молча повиснет на выключенной строке до реактивации.
      const bound = await drizzle
        .update(ticket_executors)
        .set({
          tg_user_id: fromId,
          invite_used_at: new Date().toISOString(),
          lang: message?.from?.language_code === "uz" ? "uz" : "ru",
          updated_at: new Date().toISOString(),
        })
        .where(
          and(
            eq(ticket_executors.invite_code, code),
            isNull(ticket_executors.invite_used_at),
            eq(ticket_executors.is_active, true)
          )
        )
        .returning({ id: ticket_executors.id, full_name: ticket_executors.full_name, contractor_id: ticket_executors.contractor_id })
        .execute();

      if (bound.length === 0) {
        // Не сообщаем, был ли код вообще, использован ли уже, чей он, был ли
        // исполнитель деактивирован — ответ одинаковый на любую причину отказа.
        if (token) await sendMessage(token, chatId, { text: "Ссылка недействительна или уже использована. Попросите новую." });
        return { ok: true };
      }

      // Привязка уже зафиксирована в БД (UPDATE выше успешно закоммитился) —
      // всё, что дальше, это уведомление, а не часть транзакции. Если тут
      // что-то бросит исключение (упавший SELECT подрядчика, сеть до
      // Telegram), обработчик не должен превращаться в 500: Telegram
      // повторит тот же апдейт, тот же invite_code больше не найдёт свободной
      // строки (invite_used_at уже проставлен) и человек, которого только что
      // привязали, получит ответ «ссылка недействительна» — хотя он уже
      // привязан. Поэтому всё после успешного UPDATE — под try/catch, и в
      // любом случае наружу уходит 200 с ok:true: бинд состоялся, ответ
      // обязан это подтвердить.
      try {
        const [contractor] = bound[0].contractor_id
          ? await drizzle.select({ name: ticket_contractors.name }).from(ticket_contractors).where(eq(ticket_contractors.id, bound[0].contractor_id)).execute()
          : [];

        if (token) {
          await sendMessage(token, chatId, {
            text: `Вы добавлены как исполнитель${contractor?.name ? `, фирма «${contractor.name}»` : ""}. Заявки будут приходить сюда.`,
          });
        }
      } catch (e) {
        console.error("tickets bot: привязка исполнителя прошла, но уведомление не отправлено", e);
      }
      return { ok: true };
    },
    { body: t.Any() }
  );
