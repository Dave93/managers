import type { UniqueIdentifier } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent, CardHeader } from "@admin/components/ui/card";
import { Button } from "@admin/components/ui/button";
import { cva } from "class-variance-authority";
import { GripVertical } from "lucide-react";
import { Badge } from "@admin/components/ui/badge";
import { ProductGroupsListDto } from "@backend/modules/product_groups/dto/productGroupsList.dto";
import useToken from "@admin/store/get-token";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Select, SelectItem } from "@nextui-org/react";
import { useMemo } from "react";
import { InferSelectModel } from "drizzle-orm";
import { organization } from "backend/drizzle/schema";
import EditProductOrganizations from "./edit_product_organizations";

export interface Task {
  id: UniqueIdentifier;
  columnId: string;
  content: string;
}

interface TaskCardProps {
  task: ProductGroupsListDto;
  isOverlay?: boolean;
}

export type TaskType = "Task";

export interface TaskDragData {
  type: TaskType;
  task: ProductGroupsListDto;
}

export function TaskCard({ task, isOverlay }: TaskCardProps) {
  // const token = useToken();
  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: {
      type: "Task",
      task,
    } satisfies TaskDragData,
    attributes: {
      roleDescription: "Task",
    },
  });

  const style = {
    transition,
    transform: CSS.Translate.toString(transform),
  };

  const variants = cva("", {
    variants: {
      dragging: {
        over: "ring-2 opacity-30",
        overlay: "ring-2 ring-primary",
      },
    },
  });

  // const { data, isLoading } = useQuery({
  //   queryKey: ["organization"],
  //   queryFn: async () => {
  //     return await apiClient.api.organization.get({
  //       query: {
  //         fields: "id,name",
  //         limit: "1000",
  //         offset: "0",
  //       },
  //       headers: {
  //         Authorization: `Bearer ${token}`,
  //       },
  //     });
  //   },
  //   enabled: !!token,
  // });

  // const setOrganizationMutation = useMutation({
  //   mutationFn: async ({ organization_id }: { organization_id: string }) => {
  //     return await apiClient.api.nomenclature_element_organization.set.post(
  //       {
  //         data: {
  //           nomenclature_element_id: task.id,
  //           organization_id: organization_id,
  //         },
  //       },
  //       {
  //         headers: {
  //           Authorization: `Bearer ${token}`,
  //         },
  //       }
  //     );
  //   },
  //   onSuccess: () => {
  //     // queryClient.invalidateQueries({
  //     //   queryKey: ["organization"],
  //     // });
  //   },
  // });

  // const organizations = useMemo(() => {
  //   let res: InferSelectModel<typeof organization>[] = [];
  //   if (data?.data && data.data.data && Array.isArray(data.data.data)) {
  //     res = data.data.data;
  //   }
  //   return res;
  // }, [data?.data]);

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={variants({
        dragging: isOverlay ? "overlay" : isDragging ? "over" : undefined,
      })}
    >
      <CardHeader className="px-3 py-3 space-between flex flex-row border-b-2 border-secondary relative items-center justify-between">
        <Button
          variant={"ghost"}
          {...attributes}
          {...listeners}
          className="p-1 text-secondary-foreground/50 -ml-2 h-auto cursor-grab"
        >
          <span className="sr-only">Move task</span>
          <GripVertical />
        </Button>
        <div className="font-bold">{task.name}</div>
      </CardHeader>
      <CardContent className="px-3 pt-3 pb-6 text-left whitespace-pre-wrap">
        {/* <Select
          label="Организация"
          selectionMode="multiple"
          placeholder="Выберите организацию"
          // selectedKeys={}
          className="max-w-xs"
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
            console.log("e", e.target.value);
            setOrganizationMutation.mutate({
              organization_id: e.target.value,
            });
          }}
          // onSelectionChange={setValues}
        >
          {organizations.map((organization) => (
            <SelectItem key={organization.id}>{organization.name}</SelectItem>
          ))}
        </Select> */}
        <div className="flex flex-col space-y-2">
          <div className="font-bold">Организации</div>
          <div className="flex flex-row items-center gap-2">
            <div>
              {task.organization.map((organization) => (
                <Badge key={organization.id} variant="outline">
                  {organization.name}
                </Badge>
              ))}
            </div>
            <EditProductOrganizations task={task} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
