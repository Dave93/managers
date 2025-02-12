import { DeleteButton } from "@components/ui/delete-button";
import { apiClient } from "@admin/utils/eden";
import { useQueryClient, useMutation } from "@tanstack/react-query";

export default function DeleteAction({ recordId }: { recordId: string }) {
  const queryClient = useQueryClient();
  const createMutation = useMutation({
    mutationFn: () => {
      return apiClient.api.roles({ id: recordId }).delete({});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
  });

  return (
    <DeleteButton
      recordId={recordId}
      deleteRecord={() => createMutation.mutate()}
    />
  );
}
