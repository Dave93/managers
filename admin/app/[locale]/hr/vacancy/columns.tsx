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
import { useTranslations } from "next-intl";
import { useMemo } from "react";

type TFn = ReturnType<typeof useTranslations>;

export const useVacancyColumns = (): ColumnDef<any>[] => {
  const t = useTranslations("hrPages.vacancy");
  return useMemo(() => getVacancyColumns(t), [t]);
};

export const getVacancyColumns = (t: TFn): ColumnDef<any>[] => [
  {
    accessorKey: "applicationNum",
    header: t("columns.applicationNum"),
  },
  {
    accessorKey: "organization",
    header: t("columns.brand"),
    cell: ({ row }) => row.original.organization || '-'
  },
  {
    accessorKey: "positionTitle",
    header: t("columns.position"),
    cell: ({ row }) => row.original.positionTitle || '-'
  },
  {
    accessorKey: "terminal",
    header: t("columns.terminal"),
    cell: ({ row }) => row.original.terminal || '-'
  },
  {
    accessorKey: "workSchedule",
    header: t("columns.workSchedule"),
    cell: ({ row }) => row.original.workSchedule || '-'
  },
  {
    accessorKey: "candidatesCount",
    header: t("columns.candidates"),
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
    header: t("columns.status"),
    cell: ({ row }) => {
      const record = row.original;

      if (!record || !record.status) {
        return <Badge variant="default">{t("statusNotSet")}</Badge>;
      }

      const statusMap = {
        open: { 
          label: t("statuses.open"), 
          color: "text-green-500 dark:text-green-400",
          icon: CheckCircle2Icon 
        },
        in_progress: { 
          label: t("statuses.in_progress"), 
          color: "text-blue-500 dark:text-blue-400",
          icon: Clock3Icon 
        },
        found_candidates: { 
          label: t("statuses.found_candidates"), 
          color: "text-yellow-500 dark:text-yellow-400",
          icon: UsersIcon 
        },
        interview: { 
          label: t("statuses.interview"), 
          color: "text-purple-500 dark:text-purple-400",
          icon: UserCheckIcon 
        },
        closed: { 
          label: t("statuses.closed"), 
          color: "text-red-500 dark:text-red-400",
          icon: XCircleIcon 
        },
        cancelled: { 
          label: t("statuses.cancelled"), 
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
    header: t("columns.reason"),
    cell: ({ row }) => row.original.reason || '-'
  },
  {
    accessorKey: "recruiter",
    header: t("columns.recruiter"),
    cell: ({ row }) => {
      const firstName = row.original.recruiterName;
      const lastName = row.original.recruiterLastName;
      if (!firstName && !lastName) return '-';
      return `${firstName || ''} ${lastName || ''}`.trim();
    }
  },
  {
    accessorKey: "openDate",
    header: t("columns.openDate"),
    cell: ({ row }) => {
      const date = row.original.openDate;
      if (!date) return '-';
      return new Date(date).toLocaleDateString('ru-RU');
    }
  },
  {
    accessorKey: "termClosingDate",
    header: t("columns.termClosingDate"),
    cell: ({ row }) => {
      const date = row.original.termClosingDate;
      if (!date) return '-';
      return new Date(date).toLocaleDateString('ru-RU');
    }
  },
  {
    accessorKey: "closingDate",
    header: t("columns.closingDate"),
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
