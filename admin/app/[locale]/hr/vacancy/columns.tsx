"use client";
import { ColumnDef } from "@tanstack/react-table";
import { Edit2Icon, CheckCircle2Icon, CircleIcon, Clock3Icon, UsersIcon, UserCheckIcon, XCircleIcon } from "lucide-react";
import { Button } from "@admin/components/ui/buttonOrigin";
import VacancyFormSheet from "@components/forms/vacancy/sheet";
import { Badge } from "@components/ui/badge";
import { vacancy } from "@backend/../drizzle/schema";
import DeleteAction from "./delete-action";
import { cn } from "@admin/lib/utils";
import { CandidatesSheet } from "./candidates-sheet";

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
    header: "Филиал",
    cell: ({ row }) => row.original.terminal || '-'
  },
  {
    accessorKey: "workSchedule",
    header: "График работы",
    cell: ({ row }) => row.original.workSchedule || '-'
  },
  {
    accessorKey: "candidatesCount",
    header: "Кандидаты",
    cell: ({ row }) => {
      const count = row.original.candidatesCount || 0;
      const vacancyTitle = `${row.original.applicationNum} - ${row.original.positionTitle}`;
      return (
        <CandidatesSheet 
          vacancyId={row.original.id}
          vacancyTitle={vacancyTitle}
          candidatesCount={count}
        />
      );
    }
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
        open: { 
          label: "Открыта", 
          color: "text-green-500 dark:text-green-400",
          icon: CheckCircle2Icon 
        },
        in_progress: { 
          label: "В процессе", 
          color: "text-blue-500 dark:text-blue-400",
          icon: Clock3Icon 
        },
        found_candidates: { 
          label: "Найдены кандидаты", 
          color: "text-yellow-500 dark:text-yellow-400",
          icon: UsersIcon 
        },
        interview: { 
          label: "Собеседование", 
          color: "text-purple-500 dark:text-purple-400",
          icon: UserCheckIcon 
        },
        closed: { 
          label: "Закрыта", 
          color: "text-red-500 dark:text-red-400",
          icon: XCircleIcon 
        },
        cancelled: { 
          label: "Отменена", 
          color: "text-red-500 dark:text-red-400",
          icon: XCircleIcon 
        }
      } as const;

      type StatusType = keyof typeof statusMap;
      const status = statusMap[record.status as StatusType] || { 
        label: record.status, 
        color: "text-gray-500",
        icon: CircleIcon 
      };

      const Icon = status.icon;

      return (
        <Badge
          variant="outline"
          className="flex gap-1 px-1.5 text-muted-foreground [&_svg]:size-3"
        >
          <Icon className={status.color} />
          {status.label}
        </Badge>
      );
    },
  },
  {
    accessorKey: "reason",
    header: "Причина открытия",
    cell: ({ row }) => row.original.reason || '-'
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
    accessorKey: "termClosingDate",
    header: "Срок закрытия",
    cell: ({ row }) => {
      const date = row.original.termClosingDate;
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
          <VacancyFormSheet 
            recordId={record.id}
            trigger={
              <Button variant="secondary" size="sm">
                <Edit2Icon className="h-4 w-4" />
              </Button>
            }
          />
          <DeleteAction recordId={record.id} />
        </div>
      );
    },
  },
];
