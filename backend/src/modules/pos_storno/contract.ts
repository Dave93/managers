import { t } from "elysia";

// Контракт с плагином iikoFront (репо storno_plugin, docs/protocol.md). Имена полей - camelCase, как шлёт плагин.
// Менять только вместе с плагином: contract.test.ts держит примеры из protocol.md.

export const claimBody = t.Object({
  terminalId: t.String({ minLength: 1, maxLength: 64 }),
  terminalName: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
  cashRegisterNumbers: t.Array(t.Integer({ minimum: 0 }), { maxItems: 50 }),
  pluginVersion: t.Optional(t.Nullable(t.String({ maxLength: 32 }))),
  dryRun: t.Boolean(),
});

export const reportBody = t.Object({
  status: t.Union([
    t.Literal("done"),
    t.Literal("dry_run_ok"),
    t.Literal("rejected"),
    t.Literal("failed"),
    t.Literal("unknown"),
  ]),
  // Только status строгий. Остальное принимаем любым (длинное обрезается в обработчике): 422 на отчёт плагин
  // повторяет вечно и не берёт новых команд, поэтому валидация не должна отклонять отчёт из-за длины.
  message: t.Optional(t.Nullable(t.String())),
  stornoOrderId: t.Optional(t.Nullable(t.String())),
  pluginVersion: t.Optional(t.Nullable(t.String())),
});

/** Команда в ответе claim: id, orderId, cashRegisterNumber, pin, paymentTypeId обязательны, остальное может быть null. */
export const claimResponseCommand = t.Object({
  id: t.String(),
  orderId: t.String(),
  cashRegisterNumber: t.Integer(),
  pin: t.String(),
  paymentTypeId: t.String(),
  removalTypeId: t.Nullable(t.String()),
  sectionId: t.Nullable(t.String()),
  orderTypeId: t.Nullable(t.String()),
});

export const claimResponse = t.Object({ command: claimResponseCommand });
