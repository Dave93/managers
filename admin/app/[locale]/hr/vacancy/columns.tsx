"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/button";
import VacancyFormSheet from "@components/forms/vacancy/sheet";
import { Badge } from "@components/ui/badge";
import { vacancy } from "@backend/../drizzle/schema";
import DeleteAction from "./delete-action";
import { useTranslations } from "next-intl";

export function useVacancyColumns() {
  const t = useTranslations('vacancy');

  return [

    {
      accessorKey: "applicationNum",
      header: t("applicationNum"),
    },
    {
      accessorKey: "organization",
      header: t("organization"),
      cell: ({ row }) => row.original.organization || '-'
    },
    {
      accessorKey: "positionTitle",
      header: t("positionTitle"),
      cell: ({ row }) => row.original.positionTitle || '-'
    },
    {
      accessorKey: "terminal",
      header: t("terminal"),
      cell: ({ row }) => row.original.terminal || '-'
    },
    {
      accessorKey: "workSchedule",
      header: t("workSchedule"),
      cell: ({ row }) => row.original.workSchedule || '-'
    },
    {
      accessorKey: "status",
      header: t("status"),
      cell: ({ row }) => {
        const record = row.original;

        if (!record || !record.status) {
          return <Badge variant="default">Не указан</Badge>;
        }

        const statusMap = {
          open: { label: t("status_list.open"), variant: "success" as const },
          in_progress: { label: t("status_list.in_progress"), variant: "secondary" as const },
          found_candidates: { label: t("status_list.found_candidates"), variant: "outline" as const },
          interview: { label: t("status_list.interview"), variant: "secondary" as const },
          closed: { label: t("status_list.closed"), variant: "default" as const },
          cancelled: { label: t("status_list.cancelled"), variant: "destructive" as const }
        } as const;

        type StatusType = keyof typeof statusMap;
        const status = statusMap[record.status as StatusType] || { label: record.status, variant: "default" as const };

        return (
          <Badge variant={status.variant}>
            {status.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: "recruiter",
      header: t("recruiter"),
      cell: ({ row }) => {
        const firstName = row.original.recruiterName;
        const lastName = row.original.recruiterLastName;
        if (!firstName && !lastName) return '-';
        return `${firstName || ''} ${lastName || ''}`.trim();
      }
<<<<<<< HEAD
=======

      const statusMap = {
        open: { label: "Открыта", variant: "default" as const },
        in_progress: { label: "В процессе", variant: "secondary" as const },
        found_candidates: { label: "Найдены кандидаты", variant: "outline" as const },
        interview: { label: "Собеседование", variant: "secondary" as const },
        closed: { label: "Закрыта", variant: "default" as const },
        cancelled: { label: "Отменена", variant: "destructive" as const }
      } as const;

      type StatusType = keyof typeof statusMap;
      const status = statusMap[record.status as StatusType] || { label: record.status, variant: "default" as const };

      return (
        <Badge variant={status.variant}>
          {status.label}
        </Badge>
      );
>>>>>>> refs/remotes/origin/main
    },
    {
      accessorKey: "openDate",
      header: t("openDate"),
      cell: ({ row }) => {
        const date = row.original.openDate;
        if (!date) return '-';
        return new Date(date).toLocaleDateString('ru-RU');
      }
    },
    {
      accessorKey: "closingDate",
      header: t("closingDate"),
      cell: ({ row }) => {
        const date = row.original.closingDate;
        if (!date) return '-';
        return new Date(date).toLocaleDateString('ru-RU');
      }
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const record = row.original;

        return (
          <div className="flex items-center space-x-2">
            <VacancyFormSheet recordId={record.id}>
              <Button variant="secondary" size="sm">
                <Edit2Icon className="h-4 w-4" />
              </Button>
            </VacancyFormSheet>
            <DeleteAction recordId={record.id} />
          </div>
        );
      },
    },
  ] as ColumnDef<any>[];
}
