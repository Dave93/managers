import { Column } from "./board_column";
import { Switch } from "@nextui-org/switch";
import { Popover, PopoverTrigger, PopoverContent } from "@nextui-org/popover";
import { Button } from "../ui/button";
import useToken from "@admin/store/get-token";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { useState } from "react";

export const ToggleGroupInventory = ({ group }: { group: Column }) => {
  const [isOpen, setIsOpen] = useState(false);
  const token = useToken();
  const queryClient = useQueryClient();
  const updateMutation = useMutation({
    mutationFn: async () => {
      return await apiClient.api
        .product_groups({
          id: group.id,
        })
        .put(
          {
            data: {
              show_inventory: !group.show_inventory,
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
      setIsOpen(false);
      queryClient.invalidateQueries({
        queryKey: ["product_groups"],
      });
    },
  });

  return (
    <div className="flex flex-row items-center gap-2 justify-end">
      <span className="text-sm">Показывать в инвентаре</span>
      <Popover
        showArrow
        offset={10}
        placement="bottom"
        backdrop="blur"
        isOpen={isOpen}
        onOpenChange={(open) => setIsOpen(open)}
      >
        <PopoverTrigger>
          <Switch isSelected={group.show_inventory} isReadOnly />
        </PopoverTrigger>
        <PopoverContent className="w-[200px] px-4 py-2">
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
