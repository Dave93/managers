import { Active, DataRef, Over } from "@dnd-kit/core";
import { ColumnDragData } from "./board_column";
import { TaskDragData } from "./task_card";

type DraggableData = ColumnDragData | TaskDragData;

export function hasDraggableData<T extends Active | Over>(
    entry: T | null | undefined
): entry is T & {
    data: DataRef<DraggableData>;
} {
    if (!entry) {
        return false;
    }

    const data = entry.data.current;

    if (data?.type === "Column" || data?.type === "Task") {
        return true;
    }

    return false;
}
