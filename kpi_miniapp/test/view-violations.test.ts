import { expect, it } from "bun:test";
import type { TgDisputeInfo, TgViolation, TgViolations } from "@backend/modules/kpi/tg-app/types";
import { violationsView } from "../src/view/violations";

const dispute = (o: Partial<TgDisputeInfo> = {}): TgDisputeInfo => ({
  state: "can",
  deadline: "2026-11-10T18:59:59.999Z",
  opened_at: null,
  last_resolved: null,
  ...o,
});

const viol = (id: string, o: Partial<TgViolation> = {}): TgViolation => ({
  id,
  item_title_ru: null,
  item_title_uz: null,
  occurred_at: "2026-10-14T14:40:00.000Z",
  comment: "",
  status: "active",
  cancel_reason: null,
  photo_ids: [],
  dispute: dispute(),
  ...o,
});

// Макет screens.html, экран 2: действующее с фото, отменённое без пункта карты; плюс нарушение
// со спором. Новые сверху, как отдаёт сервер: 14, 9 и 5 октября.
function ex(): TgViolations {
  return {
    period: "2026-10-01",
    reason_min: 5,
    items: [
      viol("v-1", {
        item_title_ru: "Чистота филиала",
        item_title_uz: "Filial tozaligi",
        comment: "Грязный пол у кассы в час пик",
        photo_ids: ["p-1", "p-2"],
      }),
      viol("v-2", {
        occurred_at: "2026-10-09T05:00:00.000Z",
        comment: "Не убрано рабочее место",
        status: "cancelled",
        cancel_reason: "записано по ошибке",
        dispute: dispute({ state: "cancelled" }),
      }),
      viol("v-3", {
        item_title_ru: "Гигиена сотрудника",
        item_title_uz: "Xodim gigiyenasi",
        occurred_at: "2026-10-05T05:10:00.000Z",
        comment: "Без головного убора",
        dispute: dispute({ state: "open", opened_at: "2026-10-20T07:00:00.000Z" }),
      }),
    ],
  };
}

it("макет: заголовок, время по Ташкенту, статусы, строки вместо «Оспорить», пояснение", () => {
  const vm = violationsView(ex(), "ru");
  expect(vm.title).toBe("Нарушения · октябрь");
  expect(vm.empty).toBe(false);
  expect(vm.note).toBe("Нарушение само балл не снижает. Его учитывает оценщик, когда ставит оценку.");
  // Порядок сервера (новые сверху) не меняется.
  expect(vm.items.map((x) => x.id)).toEqual(["v-1", "v-2", "v-3"]);

  expect(vm.items[0]).toEqual({
    id: "v-1",
    item: "Чистота филиала",
    when: "14 октября, 19:40",
    comment: "Грязный пол у кассы в час пик",
    status: { text: "действует", tone: "active" },
    cancelReason: null,
    photoIds: ["p-1", "p-2"],
    canDispute: true,
    line: null,
    // Спора не было — решения нет.
    resolved: null,
  });
  expect(vm.items[1]).toMatchObject({
    item: "Без пункта карты",
    when: "9 октября, 10:00",
    status: { text: "отменено", tone: "muted" },
    cancelReason: "записано по ошибке",
    canDispute: false,
    line: "Нарушение отменено, оспаривать нечего.",
  });
  expect(vm.items[2]).toMatchObject({
    item: "Гигиена сотрудника",
    when: "5 октября, 10:10",
    status: { text: "спор открыт", tone: "warn" },
    canDispute: false,
    line: "Вы оспорили нарушение 20 октября. Ответ придёт в бот.",
  });
});

it("строка у нарушения без «Оспорить»: срок прошёл, месяц закрыт, спор без даты", () => {
  const one = (d: Partial<TgDisputeInfo>) => violationsView({ period: "2026-10-01", reason_min: 5, items: [viol("v", { dispute: dispute(d) })] }, "ru").items[0]!;
  expect(one({ state: "window_closed" })).toMatchObject({ canDispute: false, line: "Срок спора прошёл.", status: { text: "действует", tone: "active" } });
  expect(one({ state: "period_closed" })).toMatchObject({ canDispute: false, line: "Месяц закрыт, оспорить нельзя." });
  // Сервер даёт дату всегда, когда спор открыт; без неё — статус, а не пустая строка.
  expect(one({ state: "open", opened_at: null })).toMatchObject({ line: "Спор на рассмотрении", status: { tone: "warn" } });
});

it("узбекский: название пункта, дата, статусы, строки", () => {
  const vm = violationsView(ex(), "uz");
  expect(vm.title).toBe("Qoidabuzarliklar · oktabr");
  expect(vm.items.map((x) => x.item)).toEqual(["Filial tozaligi", "Kartadan tashqari", "Xodim gigiyenasi"]);
  expect(vm.items[0]!.when).toBe("14-oktabr, 19:40");
  expect(vm.items.map((x) => x.status.text)).toEqual(["kuchda", "bekor qilingan", "eʼtiroz ochilgan"]);
  expect(vm.items[1]!.line).toBe("Qoidabuzarlik bekor qilingan, eʼtiroz kerak emas.");
  expect(vm.items[2]!.line).toBe("Siz 20-oktabr kuni qoidabuzarlikka eʼtiroz bildirdingiz. Javob botga keladi.");
  expect(vm.note).toBe("Qoidabuzarlik balni oʻzi pasaytirmaydi. Uni baholovchi baho qoʻyishda hisobga oladi.");
});

it("узбекского названия нет — русское; пустые строки — как отсутствие", () => {
  const vm = violationsView(
    {
      period: "2026-10-01",
      reason_min: 5,
      items: [
        viol("a", { item_title_ru: "Чистота кухни", item_title_uz: null }),
        viol("b", { item_title_ru: "Чистота кухни", item_title_uz: "" }),
        viol("c", { item_title_ru: "", item_title_uz: "" }),
        viol("d", { status: "cancelled", cancel_reason: "  ", dispute: dispute({ state: "cancelled" }) }),
      ],
    },
    "uz",
  );
  expect(vm.items.map((x) => x.item)).toEqual(["Чистота кухни", "Чистота кухни", "Kartadan tashqari", "Kartadan tashqari"]);
  expect(vm.items[3]!.cancelReason).toBeNull();
});

// Решение по спору (спека, раздел 6): уведомление dispute_resolved ведёт на этот экран, и
// сотрудник должен увидеть решение и комментарий к нему, как во «Вся оценка».
const resolvedAt = "2026-10-22T09:00:00.000Z";
const one = (v: TgViolation, l: "ru" | "uz" = "ru") => violationsView({ period: "2026-10-01", reason_min: 5, items: [v] }, l).items[0]!;

it("спор отклонён: нарушение действует, решение и комментарий в строке; «Оспорить» — как решил сервер", () => {
  const lr = { decision: "rejected", comment: "Фото подтверждает нарушение", resolved_at: resolvedAt } as const;
  expect(one(viol("v", { dispute: dispute({ last_resolved: lr }) }))).toMatchObject({
    status: { text: "действует", tone: "active" },
    canDispute: true,
    line: null,
    resolved: { title: "Спор отклонён", comment: "Комментарий: Фото подтверждает нарушение" },
  });
  expect(one(viol("v", { dispute: dispute({ state: "window_closed", last_resolved: lr }) }))).toMatchObject({
    canDispute: false,
    line: "Срок спора прошёл.",
    resolved: { title: "Спор отклонён", comment: "Комментарий: Фото подтверждает нарушение" },
  });
});

it("спор принят: нарушение отменено с комментарием решения — комментарий один раз, в решении", () => {
  // Так пишет сервер: принятый спор отменяет нарушение, причина отмены — комментарий решения.
  const accepted = viol("v", {
    status: "cancelled",
    cancel_reason: "Фото не с этого филиала",
    dispute: dispute({ state: "cancelled", last_resolved: { decision: "accepted", comment: "Фото не с этого филиала", resolved_at: resolvedAt } }),
  });
  expect(one(accepted)).toMatchObject({
    status: { text: "отменено", tone: "muted" },
    // Причина та же, что комментарий решения: в строке даты её не повторяем.
    cancelReason: null,
    canDispute: false,
    line: "Нарушение отменено, оспаривать нечего.",
    resolved: { title: "Спор принят", comment: "Комментарий: Фото не с этого филиала" },
  });
  // Спор отклонили, а потом нарушение отменили по другой причине — видно и то, и другое.
  const later = viol("v", {
    status: "cancelled",
    cancel_reason: "записано по ошибке",
    dispute: dispute({ state: "cancelled", last_resolved: { decision: "rejected", comment: "Нарушение подтверждено", resolved_at: resolvedAt } }),
  });
  expect(one(later)).toMatchObject({
    cancelReason: "записано по ошибке",
    resolved: { title: "Спор отклонён", comment: "Комментарий: Нарушение подтверждено" },
  });
  // Причина отмены совпала с комментарием отклонения — это не принятый спор, причину не прячем.
  const same = viol("v", {
    status: "cancelled",
    cancel_reason: "Нарушение подтверждено",
    dispute: dispute({ state: "cancelled", last_resolved: { decision: "rejected", comment: "Нарушение подтверждено", resolved_at: resolvedAt } }),
  });
  expect(one(same).cancelReason).toBe("Нарушение подтверждено");
});

it("решение без комментария — только пометка; узбекский", () => {
  for (const comment of [null, "  "]) {
    expect(one(viol("v", { dispute: dispute({ last_resolved: { decision: "rejected", comment, resolved_at: resolvedAt } }) })).resolved).toEqual({
      title: "Спор отклонён",
      comment: null,
    });
  }
  expect(one(viol("v", { dispute: dispute({ last_resolved: { decision: "rejected", comment: "Rasm tasdiqlaydi", resolved_at: resolvedAt } }) }), "uz").resolved).toEqual({
    title: "Eʼtiroz rad etildi",
    comment: "Izoh: Rasm tasdiqlaydi",
  });
  expect(one(viol("v", { status: "cancelled", dispute: dispute({ state: "cancelled", last_resolved: { decision: "accepted", comment: null, resolved_at: resolvedAt } }) }), "uz").resolved).toEqual({
    title: "Eʼtiroz qabul qilindi",
    comment: null,
  });
});

it("пустой месяц: «Нарушений нет», пояснение всё равно внизу", () => {
  const vm = violationsView({ period: "2026-11-01", reason_min: 5, items: [] }, "ru");
  expect(vm).toEqual({
    title: "Нарушения · ноябрь",
    items: [],
    note: "Нарушение само балл не снижает. Его учитывает оценщик, когда ставит оценку.",
    empty: true,
  });
});
