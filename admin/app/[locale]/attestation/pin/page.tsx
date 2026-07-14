"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { CheckCircle2, AlertCircle } from "lucide-react";

export default function ManagerPinPage() {
  const t = useTranslations("attestation");
  const qc = useQueryClient();
  const [pin, setPin] = useState("");

  const { data: status } = useQuery({
    queryKey: ["attestation_manager_pin_status"],
    queryFn: () => apiClient.api.attestation["manager-pin"].status.get(),
  });
  const hasPin = (status as any)?.data?.has_pin === true;

  const save = useMutation({
    mutationFn: () =>
      apiClient.api.attestation["manager-pin"].post({ data: { pin } }),
    onSuccess: (res: any) => {
      if (res.error) {
        toast.error(res.error.value?.message ?? t("pin.invalid"));
        return;
      }
      toast.success(t("pin.saved"));
      setPin("");
      qc.invalidateQueries({ queryKey: ["attestation_manager_pin_status"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const valid = /^\d{4,6}$/.test(pin);

  return (
    <div className="max-w-md space-y-6">
      <h2 className="text-3xl font-bold">{t("pin.title")}</h2>
      <p className="text-muted-foreground">{t("pin.desc")}</p>

      <div className="flex items-center gap-2 text-sm">
        {hasPin ? (
          <>
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <span>{t("pin.isSet")}</span>
          </>
        ) : (
          <>
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <span>{t("pin.notSet")}</span>
          </>
        )}
      </div>

      <div className="space-y-2">
        <Label>{t("pin.newPin")}</Label>
        <Input
          type="password"
          inputMode="numeric"
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
          className="text-center text-2xl tracking-widest"
        />
      </div>

      <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>
        {t("pin.save")}
      </Button>
    </div>
  );
}
