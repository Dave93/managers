"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { CheckCircle2, AlertCircle } from "lucide-react";

export default function ManagerPinsPage() {
  const t = useTranslations("attestation.managerPins");
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [debSearch, setDebSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pinValue, setPinValue] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const key = ["attestation_manager_pins", debSearch];
  const { data } = useQuery({
    queryKey: key,
    queryFn: () =>
      apiClient.api.attestation["manager-pins"].get({
        query: {
          limit: "200",
          offset: "0",
          ...(debSearch ? { search: debSearch } : {}),
        },
      }),
  });
  const rows = (data as any)?.data?.data ?? [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ["attestation_manager_pins"] });

  const setPin = useMutation({
    mutationFn: (p: { userId: string; pin: string }) =>
      apiClient.api.attestation["manager-pins"]({ userId: p.userId }).post({
        data: { pin: p.pin },
      }),
    onSuccess: (res: any) => {
      if (res.error) {
        toast.error(res.error.value?.message ?? t("invalid"));
        return;
      }
      toast.success(t("saved"));
      setEditingId(null);
      setPinValue("");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const resetPin = useMutation({
    mutationFn: (userId: string) =>
      apiClient.api.attestation["manager-pins"]({ userId }).delete({}),
    onSuccess: () => {
      toast.success(t("cleared"));
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const validPin = /^\d{4,6}$/.test(pinValue);

  return (
    <div className="space-y-4">
      <h2 className="text-3xl font-bold">{t("title")}</h2>

      <Input
        placeholder={t("search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="h-9 w-[280px]"
      />

      <div className="rounded-md border overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">{t("login")}</th>
              <th className="p-2">{t("name")}</th>
              <th className="p-2">PIN</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id} className="border-b">
                <td className="p-2 font-medium">{r.login}</td>
                <td className="p-2">
                  {[r.first_name, r.last_name].filter(Boolean).join(" ") || "—"}
                </td>
                <td className="p-2">
                  {r.has_pin ? (
                    <span className="inline-flex items-center gap-1 text-green-600">
                      <CheckCircle2 className="h-4 w-4" /> {t("pinSet")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-600">
                      <AlertCircle className="h-4 w-4" /> {t("pinNotSet")}
                    </span>
                  )}
                </td>
                <td className="p-2">
                  {editingId === r.id ? (
                    <div className="flex items-center gap-2">
                      <Input
                        type="password"
                        inputMode="numeric"
                        placeholder={t("newPin")}
                        value={pinValue}
                        onChange={(e) =>
                          setPinValue(e.target.value.replace(/\D/g, "").slice(0, 6))
                        }
                        className="h-8 w-[160px]"
                      />
                      <Button
                        size="sm"
                        disabled={!validPin || setPin.isPending}
                        onClick={() => setPin.mutate({ userId: r.id, pin: pinValue })}
                      >
                        OK
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(null);
                          setPinValue("");
                        }}
                      >
                        ✕
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingId(r.id);
                          setPinValue("");
                        }}
                      >
                        {t("setPin")}
                      </Button>
                      {r.has_pin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (confirm(t("confirmReset"))) resetPin.mutate(r.id);
                          }}
                        >
                          {t("resetPin")}
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-muted-foreground">
                  —
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
