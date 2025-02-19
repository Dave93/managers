import { DeleteButton } from "@components/ui/delete-button";
import { apiClient } from "@admin/utils/eden";
import { useQueryClient, useMutation } from "@tanstack/react-query";

export default function DeleteAction({ recordId }: { recordId: string }) {
  const queryClient = useQueryClient();
  const createMutation = useMutation({
    mutationFn: () => {
      return apiClient.api.permissions({ id: recordId }).delete({});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["permissions"] });
    },
  });

  return (
    <DeleteButton
      recordId={recordId}
      deleteRecord={() => createMutation.mutate()}
    />
  );
}
