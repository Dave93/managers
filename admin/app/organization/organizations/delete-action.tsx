import { DeleteButton } from "@components/ui/delete-button";
import { useOrganizationsDestroy } from "@admin/store/apis/organizations";

export default function DeleteAction({ recordId }: { recordId: string }) {
  const { mutateAsync: deletePermission } = useOrganizationsDestroy({});

  return <DeleteButton recordId={recordId} deleteRecord={deletePermission} />;
}
