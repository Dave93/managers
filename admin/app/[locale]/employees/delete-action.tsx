import { DeleteButton } from "@components/ui/delete-button";
import { apiClient } from "@admin/utils/eden";
import { useQueryClient, useMutation } from "@tanstack/react-query";

export default function DeleteAction({ recordId }: { recordId: string }) {
  const queryClient = useQueryClient();
  const del = useMutation({
    mutationFn: () =>
      apiClient.api.attestation.employees({ id: recordId }).delete({}),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["attestation_employees"] }),
  });
  return <DeleteButton recordId={recordId} deleteRecord={() => del.mutate()} />;
}
