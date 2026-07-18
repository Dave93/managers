"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import CanAccess from "@admin/components/can-access";
import { DeleteButton } from "@components/ui/delete-button";

export default function AnalyticsPage() {
  const t = useTranslations("attestation");
  const qc = useQueryClient();
  const [passed, setPassed] = useState<string>("");
  const [testId, setTestId] = useState<string>("");
  const [terminalId, setTerminalId] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [debSearch, setDebSearch] = useState<string>("");

  useEffect(() => {
    const id = setTimeout(() => setDebSearch(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const { data: testsData } = useQuery({
    queryKey: ["attestation_tests_all"],
    queryFn: () =>
      apiClient.api.attestation.tests.get({
        query: { limit: "200", offset: "0", fields: "id,title" },
      }),
  });
  const testList = (testsData as any)?.data?.data ?? [];

  const { data: terminalsData } = useQuery({
    queryKey: ["terminals_cached"],
    queryFn: () => apiClient.api.terminals.cached.get(),
  });
  const terminalList = [
    ...((terminalsData as any)?.data ?? terminalsData ?? []),
  ].sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), "ru"));

  const { data: summary } = useQuery({
    queryKey: ["attestation_summary"],
    queryFn: () => apiClient.api.attestation.analytics.summary.get(),
  });

  const { data: attempts } = useQuery({
    queryKey: ["attestation_attempts", passed, testId, terminalId, debSearch],
    queryFn: () =>
      apiClient.api.attestation.analytics.attempts.get({
        query: {
          limit: "100",
          offset: "0",
          ...(passed ? { passed } : {}),
          ...(testId ? { test_id: testId } : {}),
          ...(terminalId ? { terminal_id: terminalId } : {}),
          ...(debSearch ? { search: debSearch } : {}),
        },
      }),
  });

  const resetFilters = () => {
    setPassed("");
    setTestId("");
    setTerminalId("");
    setSearch("");
  };

  const resetMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.api.attestation.attempts({ id }).reset.post({}),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["attestation_attempts"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient.api.attestation.attempts({ id }).delete({}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attestation_attempts"] });
      qc.invalidateQueries({ queryKey: ["attestation_summary"] });
    },
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

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder={t("filters.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-[200px]"
        />
        <select
          className="border rounded h-9 px-2 bg-background"
          value={testId}
          onChange={(e) => setTestId(e.target.value)}
        >
          <option value="">{t("filters.test")}: {t("filters.all")}</option>
          {testList.map((x: any) => (
            <option key={x.id} value={x.id}>
              {x.title}
            </option>
          ))}
        </select>
        <select
          className="border rounded h-9 px-2 bg-background"
          value={terminalId}
          onChange={(e) => setTerminalId(e.target.value)}
        >
          <option value="">{t("filters.branch")}: {t("filters.all")}</option>
          {terminalList.map((term: any) => (
            <option key={term.id} value={term.id}>
              {term.name}
            </option>
          ))}
        </select>
        <select
          className="border rounded h-9 px-2 bg-background"
          value={passed}
          onChange={(e) => setPassed(e.target.value)}
        >
          <option value="">{t("analytics.all")}</option>
          <option value="true">{t("analytics.passed")}</option>
          <option value="false">{t("analytics.failed")}</option>
        </select>
        <Button variant="outline" className="h-9" onClick={resetFilters}>
          {t("filters.reset")}
        </Button>
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
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => resetMutation.mutate(r.id)}
                      >
                        {t("analytics.reset")}
                      </Button>
                      <DeleteButton
                        recordId={r.id}
                        deleteRecord={() => deleteMutation.mutate(r.id)}
                      />
                    </div>
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
