import { expect, it } from "bun:test";
import type { ApiResult } from "../src/api";
import { evNoticeKey, evOutcome } from "../src/view/ev-errors";

const http = (code: number, error: string | null, body: unknown = { error }): ApiResult<unknown> => ({ kind: "http", code, error, body });

it("evOutcome: успех, неизвестный исход, сессия, перезагрузка, ошибка с параметрами", () => {
  expect(evOutcome({ kind: "ok", data: {} }, "ru")).toEqual({ kind: "done" });
  expect(evOutcome({ kind: "fail", status: "offline" }, "ru")).toEqual({ kind: "unknown" });
  expect(evOutcome({ kind: "fail", status: "expired" }, "ru")).toEqual({ kind: "session" });
  expect(evOutcome(http(403, "not_evaluator"), "ru")).toEqual({ kind: "session" });
  expect(evOutcome(http(409, "already_submitted"), "ru")).toEqual({ kind: "reload", key: "ev_err_already_submitted" });
  expect(evOutcome(http(409, "dispute_closed"), "ru")).toEqual({ kind: "reload", key: "ev_err_dispute_closed" });
  expect(evOutcome(http(409, "already_cancelled"), "ru")).toEqual({ kind: "reload", key: "err_already_cancelled" });
  expect(evOutcome(http(422, "unknown_item"), "ru")).toEqual({ kind: "reload", key: "ev_err_unknown_item" });
  expect(evOutcome(http(409, "period_closed"), "ru")).toEqual({ kind: "reload", key: "err_period_closed" });
  expect(evOutcome(http(409, "too_early", { error: "too_early", opens_at: "2025-10-19T19:00:00.000Z" }), "ru"))
    .toEqual({ kind: "error", key: "ev_err_too_early", vars: { date: "20 октября" } });
  expect(evOutcome(http(422, "comment_required", { error: "comment_required", min: 5 }), "ru")).toEqual({ kind: "error", key: "err_comment_required", vars: { min: 5 } });
  expect(evOutcome(http(422, "missing_items"), "ru")).toEqual({ kind: "error", key: "ev_err_missing_items" });
  expect(evOutcome(http(418, "weird"), "ru")).toEqual({ kind: "error", key: "err_generic" });
  expect(evOutcome(http(418, null, null), "ru")).toEqual({ kind: "error", key: "err_generic" });
});
it("evNoticeKey: только экраны-заглушки", () => {
  expect([evNoticeKey("forbidden"), evNoticeKey("out_of_scope"), evNoticeKey("no_card"), evNoticeKey("weird")]).toEqual(["ev_err_forbidden", "ev_err_out_of_scope", "ev_err_no_card", null]);
});
