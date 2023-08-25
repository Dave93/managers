import { DeleteButton } from "@components/ui/delete-button";
import { useCredentialsDestroy } from "@admin/store/apis/credentials";

export default function DeleteAction({ recordId }: { recordId: string }) {
  const { mutateAsync: deletePermission } = useCredentialsDestroy({});

  return <DeleteButton recordId={recordId} deleteRecord={deletePermission} />;
}
