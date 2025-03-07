"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import VacancyFormSheet from "@components/forms/vacancy/sheet";
import { Badge } from "@components/ui/badge";
import { vacancy } from "@backend/../drizzle/schema";
import DeleteAction from "./delete-action";

export const vacancyColumns: ColumnDef<any>[] = [
  {
    accessorKey: "applicationNum",
    header: "Номер вакансии",
  },
  {
    accessorKey: "organization",
    header: "Бренд",
    cell: ({ row }) => row.original.organization || '-'
  },
  {
    accessorKey: "positionTitle",
    header: "Должность",
    cell: ({ row }) => row.original.positionTitle || '-'
  },
  {
    accessorKey: "terminal",
    header: "Терминал",
    cell: ({ row }) => row.original.terminal || '-'
  },
  {
    accessorKey: "workSchedule",
    header: "График работы",
    cell: ({ row }) => row.original.workSchedule || '-'
  },
  {
    accessorKey: "status",
    header: "Статус",
    cell: ({ row }) => {
      const record = row.original;

      if (!record || !record.status) {
        return <Badge variant="default">Не указан</Badge>;
      }

      const statusMap = {
        open: { label: "Открыта", variant: "success" as const },
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
    },
  },
  {
    accessorKey: "recruiter",
    header: "Рекрутер",
    cell: ({ row }) => {
      const firstName = row.original.recruiterName;
      const lastName = row.original.recruiterLastName;
      if (!firstName && !lastName) return '-';
      return `${firstName || ''} ${lastName || ''}`.trim();
    }
  },
  {
    accessorKey: "openDate",
    header: "Дата открытия",
    cell: ({ row }) => {
      const date = row.original.openDate;
      if (!date) return '-';
      return new Date(date).toLocaleDateString('ru-RU');
    }
  },
  {
    accessorKey: "closingDate",
    header: "Дата закрытия",
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
];
