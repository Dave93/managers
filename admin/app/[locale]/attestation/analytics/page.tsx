"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/buttonOrigin";
import { useState } from "react";
import { useTranslations } from "next-intl";
import CanAccess from "@admin/components/can-access";

export default function AnalyticsPage() {
  const t = useTranslations("attestation");
  const qc = useQueryClient();
  const [passed, setPassed] = useState<string>("");

  const { data: summary } = useQuery({
    queryKey: ["attestation_summary"],
    queryFn: () => apiClient.api.attestation.analytics.summary.get(),
  });

  const { data: attempts } = useQuery({
    queryKey: ["attestation_attempts", passed],
    queryFn: () =>
      apiClient.api.attestation.analytics.attempts.get({
        query: { limit: "100", offset: "0", ...(passed ? { passed } : {}) },
      }),
  });

  const resetMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.api.attestation.attempts({ id }).reset.post({}),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["attestation_attempts"] }),
  });

  const s = ((summary as any)?.data ?? summary) as any;
  const rows = (attempts as any)?.data?.data ?? [];

  const Tile = ({ label, value }: { label: string; value: any }) => (
    <div className="border rounded-md p-4">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <h2 className="text-3xl font-bold">{t("analytics.title")}</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Tile label={t("analytics.total")} value={s?.total ?? 0} />
        <Tile label={t("analytics.passed")} value={s?.passed ?? 0} />
        <Tile label={t("analytics.failed")} value={s?.failed ?? 0} />
        <Tile label={t("analytics.passRate")} value={`${s?.pass_rate ?? 0}%`} />
        <Tile label={t("analytics.expiringSoon")} value={s?.expiring_soon ?? 0} />
      </div>

      <div className="flex gap-2">
        <select
          className="border rounded h-9 px-2 bg-background"
          value={passed}
          onChange={(e) => setPassed(e.target.value)}
        >
          <option value="">{t("analytics.all")}</option>
          <option value="true">{t("analytics.passed")}</option>
          <option value="false">{t("analytics.failed")}</option>
        </select>
      </div>

      <div className="rounded-md border overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">{t("analytics.employee")}</th>
              <th className="p-2">{t("analytics.test")}</th>
              <th className="p-2">{t("analytics.score")}</th>
              <th className="p-2">{t("analytics.status")}</th>
              <th className="p-2">{t("analytics.expires")}</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r: any) => (
              <tr key={r.id} className="border-b">
                <td className="p-2">
                  {r.first_name} {r.last_name}
                </td>
                <td className="p-2">{r.test_title}</td>
                <td className="p-2">{r.score ?? "—"}%</td>
                <td className="p-2">
                  {r.passed ? "✅" : "❌"} {r.status}
                </td>
                <td className="p-2">
                  {r.expires_at
                    ? new Date(r.expires_at).toLocaleDateString()
                    : "—"}
                </td>
                <td className="p-2">
                  <CanAccess permission="attestation.reset">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => resetMutation.mutate(r.id)}
                    >
                      {t("analytics.reset")}
                    </Button>
                  </CanAccess>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
