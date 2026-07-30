"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { Textarea } from "@components/ui/textarea";
import { Button } from "@admin/components/ui/buttonOrigin";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@components/ui/alert-dialog";
import { useCanAccess } from "@admin/components/use-can-access";
import {
  adjustCompany,
  listPayments,
  payCompany,
  type CreditOpResult,
} from "@admin/lib/credit-api";
import { formatSum } from "../columns";

const OP_ERROR_MESSAGES: Record<string, string> = {
  bad_amount: "Некорректная сумма",
  not_found: "Компания не найдена",
  service_error: "Ошибка сервиса, попробуйте ещё раз",
};

export default function PaymentsTab({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const canPay = useCanAccess("credit.pay");

  const paymentsQueryKey = ["credit_payments", companyId];
  const { data, isLoading } = useQuery({
    queryKey: paymentsQueryKey,
    queryFn: async () => {
      const { data } = await listPayments(companyId);
      return data;
    },
  });
  const payments = data?.data ?? [];

  // Payments/adjustments move posted/reserved (shown in the company header)
  // and every open statement query for this company — invalidate all three
  // families. queryKey prefix-matches, so ["credit_statement", companyId]
  // catches statement-tab's queries regardless of their from/to/brand params.
  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: paymentsQueryKey });
    queryClient.invalidateQueries({ queryKey: ["credit_company", companyId] });
    queryClient.invalidateQueries({ queryKey: ["credit_statement", companyId] });
    queryClient.invalidateQueries({ queryKey: ["credit_summary"] });
  };

  // ---- Payment form ----
  const [amount, setAmount] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [docDate, setDocDate] = useState("");
  const [note, setNote] = useState("");

  const payMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await payCompany(companyId, {
        amount: Math.round(Number(amount) * 100),
        doc_number: docNumber,
        doc_date: docDate || undefined,
        note: note || undefined,
      });
      // Eden resolves (never throws) on non-2xx — the route only sets a 400
      // status when `ok` is false, so a thrown Error here is reserved for
      // that case; {ok:true, reason:"duplicate_doc"} is a 200 and is handled
      // in onSuccess below, not here.
      if (error) throw new Error((error.value as CreditOpResult)?.reason ?? "unknown");
      return data;
    },
    onSuccess: (result) => {
      if (result?.reason === "duplicate_doc") {
        toast.error("Платёжка с этим номером уже проведена");
      } else {
        toast.success("Платёж проведён");
        setAmount("");
        setDocNumber("");
        setDocDate("");
        setNote("");
      }
      invalidateAll();
    },
    onError: (err: any) => {
      // Falls back to the raw reason (not a generic message) for any code
      // the service adds that this map hasn't caught up with yet — OpResult
      // errors are shown verbatim per the brief, not swallowed into "unknown".
      toast.error(OP_ERROR_MESSAGES[err.message] ?? `Не удалось провести платёж: ${err.message}`);
    },
  });

  const paymentValid = Number(amount) > 0 && docNumber.trim().length > 0;

  // ---- Adjustment form ----
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");

  const adjustMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await adjustCompany(companyId, {
        amount: Math.round(Number(adjAmount) * 100),
        reason: adjReason,
      });
      if (error) throw new Error((error.value as CreditOpResult)?.reason ?? "unknown");
      return data;
    },
    onSuccess: () => {
      toast.success("Корректировка применена");
      setAdjAmount("");
      setAdjReason("");
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(OP_ERROR_MESSAGES[err.message] ?? `Не удалось применить корректировку: ${err.message}`);
    },
  });

  const adjustmentValid = Number(adjAmount) !== 0 && !Number.isNaN(Number(adjAmount)) && adjReason.trim().length > 0;

  return (
    <div className="space-y-8 py-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Дата</TableHead>
              <TableHead>Сумма</TableHead>
              <TableHead>№ платёжки</TableHead>
              <TableHead>Дата платёжки</TableHead>
              <TableHead>Примечание</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-16 text-center text-muted-foreground">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : payments.length ? (
              payments.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{new Date(p.created_at).toLocaleString("ru-RU")}</TableCell>
                  <TableCell>{formatSum(p.amount)}</TableCell>
                  <TableCell>{p.doc_number ?? "—"}</TableCell>
                  <TableCell>
                    {p.doc_date ? new Date(p.doc_date).toLocaleDateString("ru-RU") : "—"}
                  </TableCell>
                  <TableCell>{p.note ?? "—"}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-16 text-center text-muted-foreground">
                  Нет платежей
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {canPay && (
        <>
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Погасить долг</h4>
            <form
              onSubmit={(e) => e.preventDefault()}
              className="flex items-end gap-2 flex-wrap"
            >
              <div className="space-y-1">
                <Label>Сумма (сум)</Label>
                <Input
                  type="number"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="w-40"
                />
              </div>
              <div className="space-y-1">
                <Label>№ платёжки *</Label>
                <Input
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  className="w-40"
                />
              </div>
              <div className="space-y-1">
                <Label>Дата платёжки</Label>
                <Input
                  type="date"
                  value={docDate}
                  onChange={(e) => setDocDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Примечание</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} className="w-56" />
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" disabled={!paymentValid || payMutation.isPending}>
                    {payMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Погасить
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Провести платёж?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Сумма {amount || 0} сум по платёжке №{docNumber || "—"} будет списана с долга
                      компании. Действие нельзя отменить.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => payMutation.mutate()}
                      disabled={payMutation.isPending}
                    >
                      Подтвердить
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </form>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Корректировка баланса</h4>
            <p className="text-xs text-muted-foreground">
              Плюс уменьшает долг, минус увеличивает.
            </p>
            <form
              onSubmit={(e) => e.preventDefault()}
              className="flex items-end gap-2 flex-wrap"
            >
              <div className="space-y-1">
                <Label>Сумма (сум, ± )</Label>
                <Input
                  type="number"
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  placeholder="-100000"
                  className="w-40"
                />
              </div>
              <div className="space-y-1">
                <Label>Причина *</Label>
                <Textarea
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  className="w-64"
                  rows={1}
                />
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  {/* No idempotency key on adjustments (unlike payments, which
                      gate on doc_number) — applyAdjustment inserts a new
                      credit_entries row on every call with no replay guard.
                      A double-click here double-applies the adjustment, so
                      the isPending disable is load-bearing, not cosmetic. */}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!adjustmentValid || adjustMutation.isPending}
                  >
                    {adjustMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Применить
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Применить корректировку?</AlertDialogTitle>
                    <AlertDialogDescription>
                      {adjAmount} сум ({Number(adjAmount) > 0 ? "уменьшит" : "увеличит"} долг
                      компании). Действие нельзя отменить.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Отмена</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => adjustMutation.mutate()}
                      disabled={adjustMutation.isPending}
                    >
                      Подтвердить
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
