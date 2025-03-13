import { Button } from "@admin/components/ui/buttonOrigin";
import { toast } from "sonner";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";

interface GroupAddButtonProps {
  organizationId: string;
}
//test
export const GroupAddButton = ({ organizationId }: GroupAddButtonProps) => {
  const queryClient = useQueryClient();
  const createProductGroup = useMutation({
    mutationFn: async () => {
      return await apiClient.api.product_groups.post({
        data: {
          organization_id: organizationId,
          name: "New Group",
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["product_groups"],
      });
      queryClient.invalidateQueries({
        queryKey: ["products"],
      });
      toast.success("Group added");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleClick = async () => {
    createProductGroup.mutate();
  };

  return (
    <Button variant="default" size="icon" onClick={handleClick}>
      <Plus className="h-4 w-4" />
    </Button>
  );
};
