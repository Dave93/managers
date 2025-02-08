import { useToast } from "@admin/components/ui/use-toast";
import { Button } from "@components/ui/button";

import { useMemo, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { useCallback, useState } from "react";
import { Chip } from "@nextui-org/chip";
import { users } from "@backend/../drizzle/schema";
import { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQueries } from "@tanstack/react-query";
import { Select, SelectItem, SelectedItems } from "@nextui-org/select";
import { Selection } from "@react-types/shared";

export default function UsersForm({
  setOpen,
  recordId,
}: {
  setOpen: (open: boolean) => void;
  recordId?: string;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const { toast } = useToast();
  const [changedRoleId, setChangedRoleId] = useState<string | null>(null);
  const [changedTerminalId, setChangedTerminalId] = useState<Selection>(
    new Set([])
  );
  const [changedStoreId, setChangedStoreId] = useState<Selection>(new Set([]));
  const closeForm = () => {
    form.reset();
    setOpen(false);
  };

  const onAddSuccess = (actionText: string, successData: any) => {
    toast({
      title: "Success",
      description: `User ${actionText}`,
      duration: 5000,
    });
    assignRole(successData?.data);
  };

  const onError = (error: any) => {
    toast({
      title: "Error",
      description: error.message,
      variant: "destructive",
      duration: 5000,
    });
  };

  const createMutation = useMutation({
    mutationFn: (newTodo: typeof users.$inferInsert) => {
      return apiClient.api.users.post({
        data: newTodo,
        fields: [
          "id",
          "status",
          "login",
          "password",
          "first_name",
          "last_name",
        ],
      });
    },
    onSuccess: (data) => onAddSuccess("added", data),
    onError,
  });

  const updateMutation = useMutation({
    mutationFn: (newTodo: {
      data: typeof users.$inferInsert;
      id: string;
    }) => {
      return apiClient.api.users({ id: newTodo.id }).put({
        data: newTodo.data,
        fields: [
          "id",
          "status",
          "login",
          "password",
          "first_name",
          "last_name",
        ],
      });
    },
    onSuccess: (data) => onAddSuccess("updated", data),
    onError,
  });
  const assignStoreMutation = useMutation({
    mutationFn: (newTodo: {
      corporation_store_id: string[];
      user_id: string;
    }) => {
      return apiClient.api.users_stores.assign_stores.post({
        data: { ...newTodo },
      });
    },
    onSuccess: (data) => closeForm(),
    onError,
  });

  const assignTerminalMutation = useMutation({
    mutationFn: (newTodo: { terminal_id: string[]; user_id: string }) => {
      return apiClient.api.users.assign_terminal.post({
        ...newTodo,
      });
    },
    onError,
  });
  const [
    { data: record, isLoading: isRecordLoading },
    { data: rolesData, isLoading: isRolesLoading },
    { data: terminalsData, isLoading: isTerminalsLoading },
    { data: userTerminalsData, isLoading: isUserTerminalsLoading },
    { data: storesData, isLoading: isStoresLoading },
    { data: userStoresData, isLoading: isUserStoresLoading },
  ] = useQueries({
    queries: [
      {
        queryKey: ["one_user", recordId],
        queryFn: async () => {
          if (recordId) {
            const { data } = await apiClient.api
              .users({ id: recordId })
              .get({});
            return data;
          } else {
            return null;
          }
        },
        enabled: !!recordId,
      },
      {
        queryKey: ["roles_cached"],
        queryFn: async () => {
          const { data } = await apiClient.api.roles.cached.get({});
          return data;
        },
      },
      {
        queryKey: ["terminals_cached"],
        queryFn: async () => {
          const { data } = await apiClient.api.terminals.cached.get({});
          return data;
        },
      },
      {
        enabled: !!recordId,
        queryKey: ["users_terminals", recordId],
        queryFn: async () => {
          if (recordId) {
            const { data } = await apiClient.api.users_terminals.get({
              query: {
                limit: "30",
                offset: "0",
                filters: JSON.stringify([
                  {
                    field: "user_id",
                    operator: "=",
                    value: recordId,
                  },
                ]),
                fields: "terminal_id,user_id",
              },
            });
            return data;
          } else {
            return null;
          }
        },
      },
      {
        queryKey: ["users_stores_cached"],
        queryFn: async () => {
          const { data } = await apiClient.api.users_stores.cached.get({});
          return data;
        },
      },
      {
        enabled: !!recordId,
        queryKey: ["users_stores", recordId],
        queryFn: async () => {
          if (recordId) {
            const { data } = await apiClient.api.users_stores.get({
              query: {
                limit: "30",
                offset: "0",
                filters: JSON.stringify([
                  {
                    field: "user_id",
                    operator: "=",
                    value: recordId,
                  },
                ]),
                fields: "corporation_store_id,user_id",
              },
            });
            return data;
          } else {
            return null;
          }
        },
      },
    ],
  });

  const form = useForm<typeof users.$inferInsert>({
    defaultValues: {
      status: record?.data?.status || "active",
      login: record?.data?.login || "",
      password: "",
      first_name: record?.data?.first_name || "",
      last_name: record?.data?.last_name || "",
      role_id: record?.data?.role_id || "",
    },
    onSubmit: async ({ value }) => {
      if (recordId) {
        updateMutation.mutate({ data: value, id: recordId });
      } else {
        createMutation.mutate(value);
      }
    },
  });


  const assignRole = useCallback(
    async (recordData: typeof users.$inferSelect) => {
      let userId = recordData?.id;
      if (recordId) {
        userId = recordId;
      }
      assignTerminalMutation.mutate({
        user_id: userId,
        terminal_id:
          changedTerminalId !== "all"
            ? Array.from(changedTerminalId).map((terminalId) =>
              terminalId.toString()
            )
            : [],
      });
      return assignStoreMutation.mutate({
        user_id: userId,
        corporation_store_id:
          changedStoreId !== "all"
            ? Array.from(changedStoreId).map((storeId) => storeId.toString())
            : [],
      });
    },
    [recordId, changedTerminalId, changedStoreId]
  );

  const isLoading = useMemo(() => {
    return (
      createMutation.isPending || updateMutation.isPending || isRolesLoading
    );
  }, [createMutation.isPending, updateMutation.isPending, isRolesLoading]);

  const terminalsForSelect = useMemo(() => {
    return terminalsData && Array.isArray(terminalsData)
      ? terminalsData.map((item) => ({
        value: item.id,
        label: item.name,
      }))
      : [];
  }, [terminalsData]);

  const terminalLabelById = useMemo(() => {
    return terminalsData && Array.isArray(terminalsData)
      ? terminalsData.reduce((acc, item) => {
        acc[item.id] = item.name;
        return acc;
      }, {} as { [key: string]: string })
      : {};
  }, [terminalsData]);

  const storesForSelect = useMemo(() => {
    return storesData && Array.isArray(storesData)
      ? storesData.map((item) => ({
        value: item.id,
        label: item.name,
      }))
      : [];
  }, [storesData]);

  const storeLabelById = useMemo(() => {
    return storesData && Array.isArray(storesData)
      ? storesData.reduce((acc, item) => {
        acc[item.id] = item.name!;
        return acc;
      }, {} as { [key: string]: string })
      : {};
  }, [storesData]);

  useEffect(() => {
    if (
      userTerminalsData &&
      userTerminalsData.data &&
      Array.isArray(userTerminalsData.data)
    ) {
      setChangedTerminalId(
        new Set(userTerminalsData.data.map((item) => item.terminal_id))
      );
    }

    if (
      userStoresData &&
      userStoresData.data &&
      Array.isArray(userStoresData.data)
    ) {
      setChangedStoreId(
        new Set(userStoresData.data.map((item) => item.corporation_store_id!))
      );
    }
  }, [userTerminalsData, userStoresData]);

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
      className="space-y-8"
    >
      <div className="space-y-2">
        <div>
          <Label>Статус</Label>
        </div>
        <form.Field name="status">
          {(field) => {
            return (
              <>
                <Select
                  label="Статус"
                  placeholder="Выберите статус"
                  selectedKeys={[field.getValue()]}
                  className="max-w-xs"
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                    field.setValue(
                      // @ts-ignore
                      e.target.value as "active" | "blocked" | "inactive"
                    );
                  }}
                  popoverProps={{
                    portalContainer: formRef.current!,
                    offset: 0,
                    containerPadding: 0,
                  }}
                >
                  {["active", "blocked", "inactive"].map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </Select>
              </>
            );
          }}
        </form.Field>
      </div>
      <div className="space-y-2">
        <div>
          <Label>Логин</Label>
        </div>
        <form.Field name="login">
          {(field) => {
            return (
              <>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.getValue() ?? ""}
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    // @ts-ignore
                    field.handleChange(e.target.value);
                  }}
                />
              </>
            );
          }}
        </form.Field>
      </div>
      <div className="space-y-2">
        <div>
          <Label>Пароль</Label>
        </div>
        <form.Field name="password">
          {(field) => {
            return (
              <>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.getValue() ?? ""}
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    // @ts-ignore
                    field.handleChange(e.target.value);
                  }}
                />
              </>
            );
          }}
        </form.Field>
      </div>
      <div className="space-y-2">
        <div>
          <Label>Роль</Label>
        </div>
        <form.Field name="role_id">
          {(field) => {
            return (
              <Select
                label="Роль"
                placeholder="Выберите роль"
                selectedKeys={field.getValue() ? [field.getValue() as string] : []}
                className="max-w-xs"
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                  field.setValue(e.target.value);
                }}
                popoverProps={{
                  portalContainer: formRef.current!,
                  offset: 0,
                  containerPadding: 0,
                }}
              >
                {Array.isArray(rolesData) ? (
                  rolesData?.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem key="0" value="0">
                    Загрузка...
                  </SelectItem>
                )}
              </Select>
            );
          }}
        </form.Field>
      </div>
      <div className="space-y-2">
        <div>
          <Label>Филиалы</Label>
        </div>
        <Select
          label="Филиалы"
          selectionMode="multiple"
          isMultiline={true}
          placeholder="Выберите филиал"
          selectedKeys={changedTerminalId}
          classNames={{
            base: "max-w-xs",
            trigger: "min-h-unit-12 py-2",
          }}
          onSelectionChange={setChangedTerminalId}
          popoverProps={{
            portalContainer: formRef.current!,
            offset: 0,
            containerPadding: 0,
          }}
          renderValue={(items: SelectedItems<string>) => {
            return (
              <div className="flex flex-wrap gap-2">
                {changedTerminalId != "all" &&
                  Array.from(changedTerminalId).map((item) => (
                    <Chip key={item}>{terminalLabelById[item]}</Chip>
                  ))}
              </div>
            );
          }}
        >
          {terminalsForSelect.map((terminal) => (
            <SelectItem key={terminal.value} value={terminal.value}>
              {terminal.label}
            </SelectItem>
          ))}
        </Select>
      </div>
      <div className="space-y-2">
        <div>
          <Label>Склады</Label>
        </div>
        <Select
          label="Cклады"
          selectionMode="multiple"
          isMultiline={true}
          placeholder="Выберите склады"
          selectedKeys={changedStoreId}
          classNames={{
            base: "max-w-xs",
            trigger: "min-h-unit-12 py-2",
          }}
          onSelectionChange={setChangedStoreId}
          popoverProps={{
            portalContainer: formRef.current!,
            offset: 0,
            containerPadding: 0,
          }}
          renderValue={(items: SelectedItems<string>) => {
            return (
              <div className="flex flex-wrap gap-2">
                {changedStoreId != "all" &&
                  Array.from(changedStoreId).map((item) => (
                    <Chip key={item}>{storeLabelById[item]}</Chip>
                  ))}
              </div>
            );
          }}
        >
          {storesForSelect.map((store) => (
            <SelectItem key={store.value} value={store.value}>
              {store.label}
            </SelectItem>
          ))}
        </Select>
      </div>
      <div className="space-y-2">
        <div>
          <Label>Имя</Label>
        </div>
        <form.Field name="first_name">
          {(field) => {
            return (
              <>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.getValue() ?? ""}
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    // @ts-ignore
                    field.handleChange(e.target.value);
                  }}
                />
              </>
            );
          }}
        </form.Field>
      </div>
      <div className="space-y-2">
        <div>
          <Label>Фамилия</Label>
        </div>
        <form.Field name="last_name">
          {(field) => {
            return (
              <>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.getValue() ?? ""}
                  onBlur={field.handleBlur}
                  onChange={(e) => {
                    // @ts-ignore
                    field.handleChange(e.target.value);
                  }}
                />
              </>
            );
          }}
        </form.Field>
      </div>
      <Button type="submit" disabled={isLoading}>
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Submit
      </Button>
    </form>
  );
}
