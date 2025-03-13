import { Column } from "./board_column";
import { Switch } from "../../../components/ui/switch";
import {
  Popover,
  PopoverTrigger,
  PopoverContent
} from "../../../components/ui/popover";
import { Button } from "../../../components/ui/buttonOrigin";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { useState } from "react";

export const ToggleGroupInventory = ({ group }: { group: Column }) => {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const updateMutation = useMutation({
    mutationFn: async () => {
      return await apiClient.api
        .product_groups({
          id: group.id,
        })
        .put({
          data: {
            show_inventory: !group.show_inventory,
          },
        });
    },
    onSuccess: () => {
      setIsOpen(false);
      queryClient.invalidateQueries({
        queryKey: ["product_groups"],
      });
    },
  });

  return (
    <div className="flex flex-row items-center gap-2 justify-end">
      <span className="text-sm">Показывать в инвентаре</span>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <Switch checked={group.show_inventory} className="cursor-pointer" />
        </PopoverTrigger>
        <PopoverContent className="w-[200px] p-4">
          <div className="flex flex-col gap-2">
            <div className="font-bold text-center">
              Вы уверены, что хотите{" "}
              {group.show_inventory ? "скрыть" : "показать"} в инвентаре?
            </div>
            <div className="flex flex-row justify-between">
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  updateMutation.mutate();
                }}
              >
                Да
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setIsOpen(false)}
              >
                Отмена
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
