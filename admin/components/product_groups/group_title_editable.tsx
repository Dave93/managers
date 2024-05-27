import { useState } from "react";
import { Column } from "./board_column";
import { Button } from "../ui/button";
import { Check, Edit, Edit2, RemoveFormatting, Save, X } from "lucide-react";
import { Input } from "@nextui-org/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import useToken from "@admin/store/get-token";

interface GroupTitleEditableProps {
  group: Column;
}

export const GroupTitleEditable = ({ group }: GroupTitleEditableProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const token = useToken();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState(group.title);

  const updateMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => {
      return apiClient.api
        .product_groups({
          id: id,
        })
        .put(
          {
            data: { name: title },
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
    },
    onSuccess: () => {
      setIsEditing(false);
    },
  });

  return (
    <div className="group-title-editable">
      {group.id !== "null" ? (
        <div className="group-title-editable-title">
          {isEditing ? (
            <div className="gap-2 items-center grid grid-cols-6">
              <div className="col-span-4">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  variant="bordered"
                  className="w-full"
                />
              </div>
              <div className="col-span-2 flex items-center justify-between">
                <Button
                  variant="default"
                  size="icon"
                  onClick={() => {
                    updateMutation.mutate({ id: group.id.toString(), title });
                  }}
                  disabled={updateMutation.isPending}
                >
                  <Check className="w-5 h-5" />
                </Button>
                <Button
                  variant="destructive"
                  size="icon"
                  onClick={() => {
                    setTitle(group.title);
                    setIsEditing(false);
                  }}
                  disabled={updateMutation.isPending}
                >
                  <X className="w-5 h-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex space-x-2 items-center">
              <span>{title}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsEditing(true)}
              >
                <Edit2 className="w-5 h-5" />
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div>{group.title}</div>
      )}
    </div>
  );
};
