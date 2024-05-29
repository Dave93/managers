import { Button } from "@admin/components/ui/button";
import { useToast } from "@admin/components/ui/use-toast";
import useToken from "@admin/store/get-token";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";

interface GroupAddButtonProps {
  organizationId: string;
}
//test
export const GroupAddButton = ({ organizationId }: GroupAddButtonProps) => {
  const token = useToken();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createProductGroup = useMutation({
    mutationFn: async () => {
      return await apiClient.api.product_groups.post(
        {
          data: {
            organization_id: organizationId,
            name: "New Group",
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
        queryKey: ["product_groups"],
      });
      queryClient.invalidateQueries({
        queryKey: ["products"],
      });
      toast({
        title: "Success",
        description: "Group added",
        duration: 5000,
      });
      return;
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
