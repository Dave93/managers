import { createPortal } from "react-dom";

import {
  BoardColumn,
  BoardContainer,
} from "@admin/components/product_groups/board_column";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  useSensor,
  useSensors,
  KeyboardSensor,
  Announcements,
  UniqueIdentifier,
  TouchSensor,
  MouseSensor,
} from "@dnd-kit/core";
import { SortableContext, arrayMove } from "@dnd-kit/sortable";
import {
  type Task,
  TaskCard,
} from "@admin/components/product_groups/task_card";
import type { Column } from "@admin/components/product_groups/board_column";
import { hasDraggableData } from "@admin/components/product_groups/utils";
import { coordinateGetter } from "@admin/components/product_groups/multipleContainersKeyboardPreset";
import useToken from "@admin/store/get-token";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { ProductGroupsListDto } from "@backend/modules/product_groups/dto/productGroupsList.dto";
import { GroupAddButton } from "./group_add_button";

interface ProductGroupsKanbanProps {
  organizationId: string;
}

export default function ProductGroupsKanban({
  organizationId,
}: ProductGroupsKanbanProps) {
  const token = useToken();
  const queryClient = useQueryClient();
  const pickedUpTaskColumn = useRef<string | null>(null);
  const { data: groupsData, isLoading: groupsLoading } = useQuery({
    queryKey: [
      "product_groups",
      {
        fields: ["id", "name", "sort", "show_inventory"],
      },
      organizationId,
    ],
    queryFn: async () => {
      return await apiClient.api.product_groups.get({
        query: {
          fields: "id,name,sort,show_inventory",
          limit: "1000",
          offset: "0",
          filters: JSON.stringify([
            {
              field: "organization_id",
              operator: "eq",
              value: organizationId,
            },
          ]),
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    },
    enabled: !!token,
  });

  const columns = useMemo<Column[]>(() => {
    let res = [
      {
        id: "null",
        title: "Не сортировано",
        sort: 0,
        show_inventory: false,
      },
    ];
    if (groupsData?.data?.data && Array.isArray(groupsData?.data?.data)) {
      groupsData?.data.data.forEach((group) => {
        res.push({
          id: group.id,
          title: group.name,
          sort: group.sort,
          show_inventory: group.show_inventory!,
        });
      });
    }
    res.sort((a, b) => a.sort - b.sort);
    return res;
  }, [groupsData?.data]);

  const columnIds = useMemo(() => {
    let res = ["null"];
    if (groupsData?.data?.data && Array.isArray(groupsData?.data?.data)) {
      groupsData?.data.data.forEach((group) => {
        res.push(group.id);
      });
    }
    return res;
  }, [groupsData?.data]);

  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: [
      "products",
      {
        fields: ["id", "name", "sort"],
      },
      organizationId,
    ],
    queryFn: async () => {
      return await apiClient.api.product_groups.products_with_group.get({
        query: {
          organization_id: organizationId,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    },
    enabled: !!token,
  });

  const products = useMemo<ProductGroupsListDto[]>(() => {
    if (productsData?.data && Array.isArray(productsData?.data)) {
      return productsData?.data;
    }
    return [];
  }, [productsData?.data]);

  const [activeColumn, setActiveColumn] = useState<Column | null>(null);
  const [activeTask, setActiveTask] = useState<ProductGroupsListDto | null>(
    null
  );

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: coordinateGetter,
    })
  );

  function getDraggingTaskData(taskId: UniqueIdentifier, columnId: string) {
    const tasksInColumn = products.filter((task) => task.group_id === columnId);
    const taskPosition = tasksInColumn.findIndex((task) => task.id === taskId);
    const column = columns.find((col) => col.id === columnId);
    return {
      tasksInColumn,
      taskPosition,
      column,
    };
  }

  const updateProductGroup = useMutation({
    mutationFn: async (data: { id: string; name: string; sort: number }) => {
      return await apiClient.api
        .product_groups({
          id: data.id,
        })
        .put(
          {
            data: {
              name: data.name,
              sort: data.sort,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
    },
  });

  const updateProductGroupItem = useMutation({
    mutationFn: async (data: {
      before_group_id?: string;
      id: string;
      group_id: string;
    }) => {
      return await apiClient.api.product_groups.set_group.post(
        {
          data: {
            product_id: data.id,
            before_group_id: data.before_group_id,
            group_id: data.group_id,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["products"],
      });
    },
  });

  const isLoading = useMemo(() => {
    return groupsLoading || productsLoading;
  }, [groupsLoading, productsLoading]);

  const announcements: Announcements = {
    onDragStart({ active }) {
      if (!hasDraggableData(active)) return;
      if (active.data.current?.type === "Column") {
        const startColumnIdx = columnIds.findIndex((id) => id === active.id);
        const startColumn = columns[startColumnIdx];
        return `Picked up Column ${startColumn?.title} at position: ${
          startColumnIdx + 1
        } of ${columnIds.length}`;
      } else if (active.data.current?.type === "Task") {
        pickedUpTaskColumn.current = active.data.current.task.group_id;
        const { tasksInColumn, taskPosition, column } = getDraggingTaskData(
          active.id,
          pickedUpTaskColumn.current
        );
        return `Picked up Task ${active.data.current.task.name} at position: ${
          taskPosition + 1
        } of ${tasksInColumn.length} in column ${column?.title}`;
      }
    },
    onDragOver({ active, over }) {
      if (!hasDraggableData(active) || !hasDraggableData(over)) return;

      if (
        active.data.current?.type === "Column" &&
        over.data.current?.type === "Column"
      ) {
        const overColumnIdx = columnIds.findIndex((id) => id === over.id);
        return `Column ${active.data.current.column.title} was moved over ${
          over.data.current.column.title
        } at position ${overColumnIdx + 1} of ${columnIds.length}`;
      } else if (
        active.data.current?.type === "Task" &&
        over.data.current?.type === "Task"
      ) {
        const { tasksInColumn, taskPosition, column } = getDraggingTaskData(
          over.id,
          over.data.current.task.group_id
        );
        if (over.data.current.task.group_id !== pickedUpTaskColumn.current) {
          return `Task ${active.data.current.task.name} was moved over column ${
            column?.title
          } in position ${taskPosition + 1} of ${tasksInColumn.length}`;
        }
        return `Task was moved over position ${taskPosition + 1} of ${
          tasksInColumn.length
        } in column ${column?.title}`;
      }
    },
    onDragEnd({ active, over }) {
      if (!hasDraggableData(active) || !hasDraggableData(over)) {
        pickedUpTaskColumn.current = null;
        return;
      }
      if (
        active.data.current?.type === "Column" &&
        over.data.current?.type === "Column"
      ) {
        const overColumnPosition = columnIds.findIndex((id) => id === over.id);

        return `Column ${
          active.data.current.column.title
        } was dropped into position ${overColumnPosition + 1} of ${
          columnIds.length
        }`;
      } else if (
        active.data.current?.type === "Task" &&
        over.data.current?.type === "Task"
      ) {
        const { tasksInColumn, taskPosition, column } = getDraggingTaskData(
          over.id,
          over.data.current.task.group_id
        );
        if (over.data.current.task.group_id !== pickedUpTaskColumn.current) {
          return `Task was dropped into column ${column?.title} in position ${
            taskPosition + 1
          } of ${tasksInColumn.length}`;
        }
        return `Task was dropped into position ${taskPosition + 1} of ${
          tasksInColumn.length
        } in column ${column?.title}`;
      }
      pickedUpTaskColumn.current = null;
    },
    onDragCancel({ active }) {
      pickedUpTaskColumn.current = null;
      if (!hasDraggableData(active)) return;
      return `Dragging ${active.data.current?.type} cancelled.`;
    },
  };

  function onDragStart(event: DragStartEvent) {
    console.log("onDragStart", event);
    if (!hasDraggableData(event.active)) return;
    const data = event.active.data.current;
    if (data?.type === "Column") {
      setActiveColumn(data.column);
      return;
    }

    if (data?.type === "Task") {
      setActiveTask(data.task);
      return;
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveColumn(null);
    setActiveTask(null);

    const { active, over } = event;
    if (!over) return;
    const activeId = active.id;
    const overId = over.id;

    if (!hasDraggableData(active)) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    if (activeId === overId) return;

    const isActiveAColumn = activeData?.type === "Column";
    const isActiveATask = activeData?.type === "Task";
    const isOverAColumn = overData?.type === "Column";
    if (isActiveAColumn) {
      let resultColumns = [...columns];
      const activeColumnIndex = resultColumns.findIndex(
        (col) => col.id === activeId
      );
      const overColumnIndex = resultColumns.findIndex(
        (col) => col.id === overId
      );
      resultColumns = arrayMove(
        resultColumns,
        activeColumnIndex,
        overColumnIndex
      );

      resultColumns.forEach((col, index) => {
        if (col.id.toString() == "null") {
          return;
        }
        updateProductGroup.mutate(
          {
            id: col.id.toString(),
            name: col.title,
            sort: index,
          },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({
                queryKey: ["product_groups"],
              });
            },
          }
        );
      });
    } else if (isActiveATask && isOverAColumn) {
      updateProductGroupItem.mutate({
        before_group_id:
          activeData.task.group_id == "null"
            ? undefined
            : activeData.task.group_id,
        id: activeId.toString(),
        group_id: overId.toString(),
      });
    }
  }

  function onDragOver(event: DragOverEvent) {
    console.log("onDragOver", event);
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    if (!hasDraggableData(active) || !hasDraggableData(over)) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    const isActiveATask = activeData?.type === "Task";
    const isOverATask = overData?.type === "Task";

    if (!isActiveATask) return;
  }

  return (
    <div className="relative">
      <DndContext
        accessibility={{
          announcements,
        }}
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={onDragOver}
      >
        <BoardContainer>
          <SortableContext items={columnIds}>
            {columns.map((col) => (
              <BoardColumn
                key={col.id}
                column={col}
                tasks={products.filter((task) => task.group_id === col.id)}
              />
            ))}
          </SortableContext>
        </BoardContainer>

        {"document" in window &&
          createPortal(
            <DragOverlay>
              {activeColumn && (
                <BoardColumn
                  isOverlay
                  column={activeColumn}
                  tasks={products.filter(
                    (task) => task.group_id === activeColumn.id
                  )}
                />
              )}
              {activeTask && <TaskCard task={activeTask} isOverlay />}
            </DragOverlay>,
            document.body
          )}
      </DndContext>
      <div className="absolute top-0 left-0 z-10">
        <GroupAddButton organizationId={organizationId} />
      </div>
      {isLoading && (
        <div className="absolute backdrop-blur flex h-full items-center justify-center left-0 top-0 w-full z-10">
          <svg
            className="animate-spin h-10 w-10 text-sky-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            ></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
        </div>
      )}
    </div>
  );
}
