import { ProductGroupsListDto } from "@backend/modules/product_groups/dto/productGroupsList.dto";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@components/ui/dialog";
import { Button } from "../ui/buttonOrigin";
import { Edit2Icon } from "lucide-react";
import { FC, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { organization } from "backend/drizzle/schema";
import { InferSelectModel } from "drizzle-orm";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from "@components/ui/command";
import { CheckIcon } from "lucide-react";
import { cn } from "@admin/lib/utils";

interface EditProductOrganizationsProps {
  task: ProductGroupsListDto;
}

export default function EditProductOrganizations({
  task,
}: EditProductOrganizationsProps) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <Button size="lg" variant="ghost" onClick={() => setOpen(true)}>
        <Edit2Icon className="h-3 w-3" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && (
          <DialogContent>
            <ShowOrganizationsSelect onClose={() => setOpen(false)} task={task} />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

const ShowOrganizationsSelect = ({
  onClose,
  task,
}: {
  onClose: () => void;
  task: ProductGroupsListDto;
}) => {
  const [selectedOrganizations, setSelectedOrganizations] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["organization"],
    queryFn: async () => {
      return await apiClient.api.organization.get({
        query: {
          fields: "id,name",
          limit: "1000",
          offset: "0",
        },
      });
    },
  });

  const { data: linkedOrganizations, isLoading: linkedOrganizationsLoading } =
    useQuery({
      queryKey: ["prod_organizations"],
      queryFn: async () => {
        return await apiClient.api.nomenclature_element_organization
          .get_for_product({
            id: task.id,
          })
          .get({
            query: {
              fields: "id,nomenclature_element_id,organization_id",
              limit: "1000",
              offset: "0",
            },
          });
      },
    });

  const organizations = useMemo(() => {
    let res: typeof organization.$inferSelect[] = [];
    if (data?.data && data.data.data && Array.isArray(data.data.data)) {
      res = data.data.data;
    }
    return res;
  }, [data?.data]);

  const setProductOrganizationMutation = useMutation({
    mutationFn: async ({
      organization_ids,
    }: {
      organization_ids: string[];
    }) => {
      return await apiClient.api.nomenclature_element_organization.set.post({
        data: {
          nomenclature_element_id: task.id,
          organization_ids: organization_ids,
        },
      });
    },
    onSuccess: () => {
      // queryClient.invalidateQueries({
      //   queryKey: ["organization"],
      // });
    },
  });

  useEffect(() => {
    if (linkedOrganizations?.data && Array.isArray(linkedOrganizations.data)) {
      setSelectedKeys(
        linkedOrganizations.data.map((item) => item.organization_id)
      );
    }
  }, [linkedOrganizations?.data]);

  const onSave = async () => {
    const organizationIds = selectedOrganizations.split(",");
    if (organizationIds.length == 0) {
      onClose();
      return;
    }
    setProductOrganizationMutation.mutate(
      {
        organization_ids: organizationIds,
      },
      {
        onSuccess: () => {
          // queryClient.invalidateQueries({
          //   queryKey: ["organization"],
          // });
          onClose();
        },
      }
    );
  };

  const toggleOrganization = (id: string) => {
    setSelectedKeys(prev => {
      if (prev.includes(id)) {
        return prev.filter(key => key !== id);
      } else {
        return [...prev, id];
      }
    });

    setSelectedOrganizations(prev => {
      const ids = prev ? prev.split(",") : [];
      if (ids.includes(id)) {
        return ids.filter(key => key !== id).join(",");
      } else {
        return [...ids, id].join(",");
      }
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Изменить организацию</DialogTitle>
      </DialogHeader>
      <div className="py-4">
        <Command className="rounded-lg border shadow-md">
          <CommandInput placeholder="Поиск организации..." />
          <CommandList>
            <CommandEmpty>Организации не найдены</CommandEmpty>
            <CommandGroup>
              {organizations.map((org) => (
                <CommandItem
                  key={org.id}
                  onSelect={() => toggleOrganization(org.id)}
                  className="flex items-center gap-2"
                >
                  <div className={cn(
                    "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                    selectedKeys.includes(org.id) ? "bg-primary text-primary-foreground" : "opacity-50"
                  )}>
                    {selectedKeys.includes(org.id) && (
                      <CheckIcon className="h-3 w-3" />
                    )}
                  </div>
                  <span>{org.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
      <DialogFooter>
        <Button variant="default" onClick={onSave}>
          Сохранить
        </Button>
        <Button variant="destructive" onClick={onClose}>
          Отмена
        </Button>
      </DialogFooter>
    </>
  );
};
