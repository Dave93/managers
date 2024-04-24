import { DeleteButton } from "@components/ui/delete-button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import useToken from "@admin/store/get-token";
import { apiClient } from "@admin/utils/eden";

export default function DeleteAction({ recordId }: { recordId: string }) {
  const queryClient = useQueryClient();
  const token = useToken();
  const createMutation = useMutation({
    mutationFn: () => {
      return apiClient.api.credentials({ id: recordId }).delete({
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credentials"] });
    },
  });

  return (
    <DeleteButton
      recordId={recordId}
      deleteRecord={() => createMutation.mutate()}
    />
  );
}
