"use client";

import { useMemo, useRef, useState } from "react";
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

export default function ProductGroupsListPage() {
  const columns = useMemo(() => {
    let res = [
      {
        id: "none",
        title: "Неотсортировано",
      },
    ];

    return res;
  }, []);

  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Группы продуктов</h2>
      </div>
      <div className="py-10"></div>
    </div>
  );
}
