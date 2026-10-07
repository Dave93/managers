"use client";

// Раскрытая строка очереди: то, на что финансист смотрит, прежде чем
// утвердить. Акт с итогом и фото результата, не больше.
//
// Итог берётся у сервера (work_total_amount), а не пересчитывается из позиций:
// это сумма, которую утвердит POST /tickets/payment/approve.

import { RotateCw, TriangleAlert } from "lucide-react";

import { Button } from "@admin/components/ui/buttonOrigin";
import { Skeleton } from "@components/ui/skeleton";
import { apiMessage, type ApiError, type TicketRow } from "@admin/lib/tickets-api";
import { useTicketCard } from "@admin/lib/use-tickets";

import { PhotoStrip } from "../../_components/photo-strip";
import { formatAmount, sumMinor, toMinor } from "@admin/lib/tickets-money";

// numeric(…) отдаёт «2.000»: лишние нули в количестве только шумят. Количество
// не деньги, здесь Number допустим.
function fmtQty(value: string): string {
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : value;
}

export function PaymentDetail({ ticket, colSpan }: { ticket: TicketRow; colSpan: number }) {
  const card = useTicketCard(ticket.id);
  const error = card.error as ApiError | null;

  let body: React.ReactNode;
  if (card.isPending) {
    body = (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="h-3.5 w-full max-w-md" />
        <Skeleton className="h-3.5 w-full max-w-md" />
      </div>
    );
  } else if (card.isError || !card.data) {
    const denied = error?.status === 403;
    body = (
      <div role="alert" className="flex items-start gap-2.5">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 space-y-2">
          <p className="text-[13px] font-medium">
            {denied ? "Нет доступа к карточке заявки" : "Не удалось загрузить акт и фото"}
          </p>
          <p className="max-w-xl break-words text-[12.5px] leading-snug text-muted-foreground">
            {denied
              ? "Сервер ответил отказом (403). Карточка открывается правом tickets.list."
              : error?.status === undefined
                ? "Запрос не дошёл до сервера. Проверьте соединение и повторите."
                : apiMessage(error)}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => card.refetch()}
            disabled={card.isFetching}
          >
            <RotateCw className={card.isFetching ? "size-3.5 animate-spin" : "size-3.5"} />
            {card.isFetching ? "Повторяем…" : "Повторить"}
          </Button>
        </div>
      </div>
    );
  } else {
    const c = card.data;
    const items = c.work_items ?? [];
    const result = (c.attachments ?? []).filter((a) => a.phase === "result");
    const itemsSum = sumMinor(items.map((w) => w.amount));
    const totalMinor = toMinor(c.work_total_amount);
    // Четыре повода не утверждать вслепую, и у каждого свой текст: человеку
    // нужно знать, что именно проверять. Итог акта считает сервер из позиций,
    // так что любое из этого значит порчу данных, а сумма при этом стоит в
    // строке списка рядом с кнопкой «Утвердить».
    let problem: string | null = null;
    if (items.length === 0) {
      problem = `В акте нет позиций, а итог указан: ${formatAmount(c.work_total_amount)}. Проверьте заявку, прежде чем утверждать.`;
    } else if (itemsSum === null) {
      problem =
        "Сумму одной из позиций не удалось прочитать, сверить с итогом акта нельзя. Проверьте заявку, прежде чем утверждать.";
    } else if (totalMinor === null) {
      problem = "Итог акта не удалось прочитать. Проверьте заявку, прежде чем утверждать.";
    } else if (itemsSum !== totalMinor) {
      problem = "Сумма позиций не совпадает с итогом акта. Проверьте заявку, прежде чем утверждать.";
    }
    body = (
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="min-w-0 space-y-2">
          <h4 className="text-sm font-medium">Акт выполненных работ</h4>
          <p className="text-[12px] leading-snug text-muted-foreground">
            Исполнитель: {c.executor_name ?? "не назначен"}
            {ticket.contractor_name ? `, фирма: ${ticket.contractor_name}` : ""}
          </p>
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Акт не заполнен</p>
          ) : (
            <div className="overflow-x-auto rounded-md border bg-background">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-8 px-3 py-1.5 font-medium">№</th>
                    <th className="px-3 py-1.5 font-medium">Работа</th>
                    <th className="px-3 py-1.5 text-right font-medium">Кол-во</th>
                    <th className="px-3 py-1.5 text-right font-medium">Сумма</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((w, i) => (
                    <tr key={w.id}>
                      <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                        {w.position ?? i + 1}
                      </td>
                      <td className="break-words px-3 py-1.5">{w.title}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                        {fmtQty(w.qty)}
                        {w.unit ? ` ${w.unit}` : ""}
                      </td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                        {formatAmount(w.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t bg-muted/20 font-medium">
                  <tr>
                    <td colSpan={3} className="px-3 py-1.5 text-right">
                      Итого
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">
                      {formatAmount(c.work_total_amount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {problem && (
            <p role="alert" className="text-[12.5px] leading-snug text-destructive">
              {problem}
            </p>
          )}
        </section>
        <PhotoStrip
          title="Фото результата"
          items={result}
          empty="Исполнитель не приложил фото результата"
        />
      </div>
    );
  }

  return (
    <tr id={`payment-detail-${ticket.id}`} className="bg-muted/20">
      <td colSpan={colSpan} className="px-5 py-4">
        {body}
      </td>
    </tr>
  );
}
