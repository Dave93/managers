"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useLocale } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, Edit2Icon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@admin/components/ui/tabs";
import { Button } from "@admin/components/ui/buttonOrigin";
import { cn } from "@admin/lib/utils";
import CreditCompaniesFormSheet from "@admin/components/forms/credit_companies/sheet";
import { getCompany } from "@admin/lib/credit-api";
import { STATUS_LABELS, STATUS_STYLES, formatSum } from "../columns";
import PhonesTab from "./phones-tab";
import DocumentsTab from "./documents-tab";

export default function CreditCompanyDetailPage() {
  const params = useParams();
  const locale = useLocale();
  const id = params.id as string;

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
          <ArrowLeftIcon className="mr-2 h-4 w-4" /> Назад к списку
        </Button>
      </Link>

      {isLoading ? (
        <div className="py-10 text-center text-muted-foreground">Загрузка...</div>
      ) : !company ? (
        <div className="py-10 text-center text-muted-foreground">Компания не найдена</div>
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
                  {STATUS_LABELS[company.status]}
                </span>
                {company.overdue && (
                  <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap bg-red-100 text-red-700 border-red-200">
                    Просрочка
                  </span>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                <div>Долг: {formatSum(account?.posted)}</div>
                <div>Резерв: {formatSum(account?.reserved)}</div>
                <div>Лимит всего: {formatSum(company.limit_total)}</div>
                <div>Лимит в день: {formatSum(company.limit_daily)}</div>
                <div>Лимит в месяц: {formatSum(company.limit_monthly)}</div>
              </div>
            </div>
            <CreditCompaniesFormSheet recordId={id}>
              <Button variant="outline">
                <Edit2Icon className="mr-2 h-4 w-4" /> Редактировать
              </Button>
            </CreditCompaniesFormSheet>
          </div>

          <Tabs defaultValue="phones" className="mt-8">
            <TabsList>
              <TabsTrigger value="phones">Телефоны</TabsTrigger>
              <TabsTrigger value="documents">Документы</TabsTrigger>
              <TabsTrigger value="payments">Погашения</TabsTrigger>
              <TabsTrigger value="statement">Выписка</TabsTrigger>
            </TabsList>
            <TabsContent value="phones">
              <PhonesTab companyId={id} phones={data?.phones ?? []} />
            </TabsContent>
            <TabsContent value="documents">
              <DocumentsTab companyId={id} />
            </TabsContent>
            {/* Filled by Task 6. */}
            <TabsContent value="payments">{null}</TabsContent>
            <TabsContent value="statement">{null}</TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
