"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { Switch } from "@components/ui/switch";
import { Button } from "@admin/components/ui/buttonOrigin";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@components/ui/table";
import { useCanAccess } from "@admin/components/use-can-access";
import { addPhone, updatePhone, type CreditCompanyPhone } from "@admin/lib/credit-api";

export default function PhonesTab({
  companyId,
  phones,
}: {
  companyId: string;
  phones: CreditCompanyPhone[];
}) {
  const queryClient = useQueryClient();
  const canEdit = useCanAccess("credit.edit");
  const [phone, setPhone] = useState("");
  const [employeeName, setEmployeeName] = useState("");

  // Phones arrive as part of GET /credit/companies/:id (Task 5's own parent
  // query), not a separate fetch — invalidating that one key refreshes both
  // the header numbers and this table from a single re-fetch.
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["credit_company", companyId] });

  const addMutation = useMutation({
    mutationFn: async () => {
      // Eden resolves (never throws) on non-2xx responses — the phone_taken
      // 400 has to be turned into a thrown Error here so useMutation's
      // onError actually fires.
      const { data, error } = await addPhone(companyId, {
        phone,
        employee_name: employeeName || undefined,
      });
      if (error) {
        throw new Error(error.value?.error === "phone_taken" ? "phone_taken" : "unknown");
      }
      return data;
    },
    onSuccess: () => {
      toast.success("Телефон добавлен");
      setPhone("");
      setEmployeeName("");
      invalidate();
    },
    onError: (err: any) => {
      if (err.message === "phone_taken") {
        toast.error("Телефон уже привязан к другой компании");
      } else {
        toast.error("Не удалось добавить телефон");
      }
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { data, error } = await updatePhone(id, { active });
      if (error) throw new Error("unknown");
      return data;
    },
    onSuccess: () => invalidate(),
    onError: () => toast.error("Не удалось обновить телефон"),
  });

  return (
    <div className="space-y-4 py-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Телефон</TableHead>
              <TableHead>Сотрудник</TableHead>
              <TableHead>Активен</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {phones.length ? (
              phones.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{p.phone}</TableCell>
                  <TableCell>{p.employee_name ?? "—"}</TableCell>
                  <TableCell>
                    {canEdit ? (
                      <Switch
                        checked={p.active}
                        disabled={toggleMutation.isPending}
                        onCheckedChange={(checked) =>
                          toggleMutation.mutate({ id: p.id, active: checked })
                        }
                      />
                    ) : (
                      <span className="text-sm text-muted-foreground">
                        {p.active ? "Да" : "Нет"}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="h-16 text-center text-muted-foreground">
                  Нет телефонов
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!phone) return;
            addMutation.mutate();
          }}
          className="flex items-end gap-2 flex-wrap"
        >
          <div className="space-y-1">
            <Label>Телефон</Label>
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+998..."
            />
          </div>
          <div className="space-y-1">
            <Label>Сотрудник</Label>
            <Input
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
              placeholder="Имя (опционально)"
            />
          </div>
          <Button type="submit" disabled={addMutation.isPending || !phone}>
            {addMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Добавить
          </Button>
        </form>
      )}
    </div>
  );
}
