"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
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
import { useFormatSum } from "../columns";

// Error codes that have a translated message under `errors.<code>`.
const KNOWN_OP_ERRORS = ["bad_amount", "not_found", "service_error"];

export default function PaymentsTab({ companyId }: { companyId: string }) {
  const t = useTranslations("systemPages.creditCompanies.payments");
  const tc = useTranslations("forms.common");
  const formatSum = useFormatSum();
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
        toast.error(t("duplicate"));
      } else {
        toast.success(t("paid"));
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
      toast.error(
        KNOWN_OP_ERRORS.includes(err.message)
          ? t(`errors.${err.message}`)
          : t("payFailed", { message: err.message })
      );
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
      toast.success(t("adjusted"));
      setAdjAmount("");
      setAdjReason("");
      invalidateAll();
    },
    onError: (err: any) => {
      toast.error(
        KNOWN_OP_ERRORS.includes(err.message)
          ? t(`errors.${err.message}`)
          : t("adjustFailed", { message: err.message })
      );
    },
  });

  const adjustmentValid = Number(adjAmount) !== 0 && !Number.isNaN(Number(adjAmount)) && adjReason.trim().length > 0;

  return (
    <div className="space-y-8 py-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("date")}</TableHead>
              <TableHead>{t("amount")}</TableHead>
              <TableHead>{t("docNumber")}</TableHead>
              <TableHead>{t("docDate")}</TableHead>
              <TableHead>{t("note")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-16 text-center text-muted-foreground">
                  {tc("loading")}
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
                  {t("empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {canPay && (
        <>
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">{t("payDebt")}</h4>
            <form
              onSubmit={(e) => e.preventDefault()}
              className="flex items-end gap-2 flex-wrap"
            >
              <div className="space-y-1">
                <Label>{t("amountSum")}</Label>
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
                <Label>{t("docNumberRequired")}</Label>
                <Input
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value)}
                  className="w-40"
                />
              </div>
              <div className="space-y-1">
                <Label>{t("docDate")}</Label>
                <Input
                  type="date"
                  value={docDate}
                  onChange={(e) => setDocDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>{t("note")}</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} className="w-56" />
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" disabled={!paymentValid || payMutation.isPending}>
                    {payMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {t("repay")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("payConfirmTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("payConfirmText", {
                        amount: String(amount || 0),
                        docNumber: docNumber || "—",
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => payMutation.mutate()}
                      disabled={payMutation.isPending}
                    >
                      {t("confirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </form>
          </div>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold">{t("adjustment")}</h4>
            <p className="text-xs text-muted-foreground">
              {t("adjustmentHint")}
            </p>
            <form
              onSubmit={(e) => e.preventDefault()}
              className="flex items-end gap-2 flex-wrap"
            >
              <div className="space-y-1">
                <Label>{t("adjustAmountSum")}</Label>
                <Input
                  type="number"
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  placeholder="-100000"
                  className="w-40"
                />
              </div>
              <div className="space-y-1">
                <Label>{t("reasonRequired")}</Label>
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
                    {t("apply")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("adjustConfirmTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("adjustConfirmText", {
                        amount: adjAmount,
                        direction: Number(adjAmount) > 0 ? "decrease" : "increase",
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => adjustMutation.mutate()}
                      disabled={adjustMutation.isPending}
                    >
                      {t("confirm")}
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
