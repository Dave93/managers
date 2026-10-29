"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftIcon, Edit2Icon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@admin/components/ui/tabs";
import { Button } from "@admin/components/ui/buttonOrigin";
import { cn } from "@admin/lib/utils";
import CreditCompaniesFormSheet from "@admin/components/forms/credit_companies/sheet";
import { useCanAccess } from "@admin/components/use-can-access";
import { getCompany } from "@admin/lib/credit-api";
import { getStatusLabel, STATUS_STYLES, useFormatSum } from "../columns";
import PhonesTab from "./phones-tab";
import DocumentsTab from "./documents-tab";
import PaymentsTab from "./payments-tab";
import StatementTab from "./statement-tab";

export default function CreditCompanyDetailPage() {
  const params = useParams();
  const locale = useLocale();
  const t = useTranslations("systemPages.creditCompanies");
  const tc = useTranslations("forms.common");
  const formatSum = useFormatSum();
  const id = params.id as string;
  const queryClient = useQueryClient();
  const canEdit = useCanAccess("credit.edit");

  const { data, isLoading } = useQuery({
    queryKey: ["credit_company", id],
    queryFn: async () => {
      const { data } = await getCompany(id);
      return data;
    },
  });

  const company = data?.company;
  const account = data?.account;

  return (
    <div>
      <Link href={`/${locale}/system/credit-companies`}>
        <Button variant="ghost" size="sm" className="mb-4 -ml-2">
          <ArrowLeftIcon className="mr-2 h-4 w-4" /> {t("detail.back")}
        </Button>
      </Link>

      {isLoading ? (
        <div className="py-10 text-center text-muted-foreground">{tc("loading")}</div>
      ) : !company ? (
        <div className="py-10 text-center text-muted-foreground">{t("detail.notFound")}</div>
      ) : (
        <>
          <div className="flex justify-between items-start flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <h2 className="text-3xl font-bold tracking-tight">{company.name}</h2>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
                    STATUS_STYLES[company.status]
                  )}
                >
                  {getStatusLabel(company.status, t)}
                </span>
                {company.overdue && (
                  <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap bg-red-100 text-red-700 border-red-200">
                    {t("overdue")}
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                <div>{t("detail.debt", { value: formatSum(account?.posted) })}</div>
                <div>{t("detail.reserve", { value: formatSum(account?.reserved) })}</div>
                <div>{t("detail.limitTotal", { value: formatSum(company.limit_total) })}</div>
                <div>{t("detail.limitDay", { value: formatSum(company.limit_daily) })}</div>
                <div>{t("detail.limitMonth", { value: formatSum(company.limit_monthly) })}</div>
              </div>
            </div>
            {canEdit && (
              <CreditCompaniesFormSheet
                recordId={id}
                onSaved={() => queryClient.invalidateQueries({ queryKey: ["credit_company", id] })}
              >
                <Button variant="outline">
                  <Edit2Icon className="mr-2 h-4 w-4" /> {tc("edit")}
                </Button>
              </CreditCompaniesFormSheet>
            )}
          </div>

          <Tabs defaultValue="phones" className="mt-8">
            <TabsList>
              <TabsTrigger value="phones">{t("detail.tabs.phones")}</TabsTrigger>
              <TabsTrigger value="documents">{t("detail.tabs.documents")}</TabsTrigger>
              <TabsTrigger value="payments">{t("detail.tabs.payments")}</TabsTrigger>
              <TabsTrigger value="statement">{t("detail.tabs.statement")}</TabsTrigger>
            </TabsList>
            <TabsContent value="phones">
              <PhonesTab companyId={id} phones={data?.phones ?? []} />
            </TabsContent>
            <TabsContent value="documents">
              <DocumentsTab companyId={id} />
            </TabsContent>
            <TabsContent value="payments">
              <PaymentsTab companyId={id} />
            </TabsContent>
            <TabsContent value="statement">
              <StatementTab companyId={id} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
