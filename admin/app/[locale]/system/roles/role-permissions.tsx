import { Button } from "@admin/components/ui/buttonOrigin";
import { Plus } from "lucide-react";
import { RolesPermissionsDataTable } from "./role-permissions-table";
import { useRolesPermissionsColumns } from "./role-permissions-columns";
import RolePermissionsForm from "./role-permissions-form";

export default function RolePermissions() {
  const columns = useRolesPermissionsColumns();
  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Permissions List</h2>
        <div className="flex items-center space-x-2">
          <RolePermissionsForm>
            <Button>
              <Plus className="mr-2 h-4 w-4" /> Add Permission
            </Button>
          </RolePermissionsForm>
        </div>
      </div>
      <div className="py-10">
        <RolesPermissionsDataTable columns={columns} />
      </div>
    </div>
  );
}
