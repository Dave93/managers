"use client";
import { ColumnDef } from "@tanstack/react-table";
import {
  CheckIcon,
  Edit2Icon,
  KeyRound,
  Minus,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@components/ui/button";

import dayjs from "dayjs";
import { Badge } from "@admin/components/ui/badge";
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@admin/components/ui/select";
import ReportItemsSheet from "./report-items";
import { cn } from "@admin/lib/utils";
import { reports, roles } from "@backend/../drizzle/schema";
import { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { ReportsWithRelations } from "@backend/modules/reports/dto/list.dto";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import useToken from "@admin/store/get-token";
import { Stoplist } from "@backend/modules/stoplist/dto/list.dto";

export const reportsColumns: ColumnDef<Stoplist>[] = [
  {
    accessorKey: "productId",
    header: "Продукт",
  },
  {
    accessorKey: "category",
    header: "Категория",
  },
  {
    accessorKey: "terminalId",
    header: "Терминал",
  },
  {
    accessorKey: "status",
    header: "Статус",
  },
  {
    accessorKey: "dateAdd",
    header: "Дата добавления",
    cell: ({ row }) => {
      const record = row.original;
      return <span>{dayjs(record.dateAdd).format("DD.MM.YYYY")}</span>;
    },
  },
  {
    accessorKey: "dateRemoved",
    header: "Дата удаления",
  },
  {
    accessorKey: "difference",
    header: "Разница",
  },
  {
    accessorKey: "reason",
    header: "Причина",
  },
];
