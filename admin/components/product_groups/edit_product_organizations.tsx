import { ProductGroupsListDto } from "@backend/modules/product_groups/dto/productGroupsList.dto";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  useDisclosure,
} from "@nextui-org/modal";
import { Button } from "../ui/button";
import { Edit2Icon } from "lucide-react";
import { FC, useEffect, useMemo, useRef, useState } from "react";
import useToken from "@admin/store/get-token";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { organization } from "backend/drizzle/schema";
import { InferSelectModel } from "drizzle-orm";
import { Select, SelectItem } from "@nextui-org/select";

interface EditProductOrganizationsProps {
  task: ProductGroupsListDto;
}

export default function EditProductOrganizations({
  task,
}: EditProductOrganizationsProps) {
  const { isOpen, onOpen, onClose } = useDisclosure();
  return (
    <div>
      <Button size="xs" variant="ghost" onClick={onOpen}>
        <Edit2Icon className="h-3 w-3" />
      </Button>
      <Modal backdrop="blur" isOpen={isOpen} onClose={onClose}>
        {isOpen && (
          <ModalContent>
            {(onClose) => (
              <>
                <ShowOrganizationsSelect onClose={onClose} task={task} />
              </>
            )}
          </ModalContent>
        )}
      </Modal>
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
  const token = useToken();
  const formRef = useRef<HTMLDivElement | null>(null);
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
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    },
    enabled: !!token,
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
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });
      },
      enabled: !!token,
    });

  const organizations = useMemo(() => {
    let res: InferSelectModel<typeof organization>[] = [];
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
      return await apiClient.api.nomenclature_element_organization.set.post(
        {
          data: {
            nomenclature_element_id: task.id,
            organization_ids: organization_ids,
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

  return (
    <>
      <ModalHeader className="flex flex-col gap-1">
        Изменить организацию
      </ModalHeader>
      <ModalBody>
        <div ref={formRef}>
          <Select
            label="Организация"
            selectionMode="multiple"
            placeholder="Выберите организацию"
            popoverProps={{
              portalContainer: formRef.current!,
              offset: 0,
              containerPadding: 0,
            }}
            selectedKeys={selectedKeys}
            className="max-w-xs"
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
              console.log("e", e.target.value);
              // setOrganizationMutation.mutate({
              //   organization_id: e.target.value,
              // });
              setSelectedOrganizations(e.target.value);
              setSelectedKeys(e.target.value.split(","));
            }}
            // onSelectionChange={setValues}
          >
            {organizations.map((organization) => (
              <SelectItem key={organization.id}>{organization.name}</SelectItem>
            ))}
          </Select>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button color="primary" variant="default" onClick={onSave}>
          Сохранить
        </Button>
        <Button color="danger" variant="destructive" onClick={onClose}>
          Отмена
        </Button>
      </ModalFooter>
    </>
  );
};
