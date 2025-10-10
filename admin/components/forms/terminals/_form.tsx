import { toast } from "sonner";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Switch } from "@components/ui/switch";

import { useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export default function TerminalsForm({
  setOpen,
  recordId,
}: {
  setOpen: (open: boolean) => void;
  recordId?: string;
}) {
  const queryClient = useQueryClient();

  const onAddSuccess = (actionText: string) => {
    toast.success(`Terminal ${actionText}`);
    queryClient.invalidateQueries({ queryKey: ["terminals"] });
    setOpen(false);
  };

  const onError = (error: any) => {
    toast.error(error.message);
  };

  const createMutation = useMutation({
    mutationFn: (newTodo: {
      name: string;
      active?: boolean;
      phone?: string;
      address?: string;
      latitude: number;
      longitude: number;
      organization_id: string;
      manager_name?: string;
    }) => {
      return apiClient.api.terminals.post({
        data: newTodo,
      });
    },
    onSuccess: () => onAddSuccess("added"),
    onError,
  });

  const updateMutation = useMutation({
    mutationFn: (newTodo: {
      data: {
        name: string;
        active?: boolean;
        phone?: string;
        address?: string;
        latitude: number;
        longitude: number;
        organization_id: string;
        manager_name?: string;
      };
      id: string;
    }) => {
      return apiClient.api.terminals({ id: newTodo.id }).put({
        data: newTodo.data,
      });
    },
    onSuccess: () => onAddSuccess("updated"),
    onError,
  });

  // @ts-ignore
  const form = useForm<{
    name: string;
    active?: boolean;
    phone?: string;
    address?: string;
    latitude: number;
    longitude: number;
    organization_id: string;
    manager_name?: string;
  }>({
    defaultValues: {
      active: true,
      name: "",
      phone: "",
      latitude: 0,
      longitude: 0,
      organization_id: "",
    },
    onSubmit: async ({ value }) => {
      if (recordId) {
        updateMutation.mutate({ data: value, id: recordId });
      } else {
        createMutation.mutate(value);
      }
    },
  });

  const { data: record, isLoading: isRecordLoading } = useQuery({
    queryKey: ["one_terminal", recordId],
    queryFn: () => {
      if (recordId) {
        return apiClient.api.terminals({ id: recordId }).get({});
      } else {
        return null;
      }
    },
    enabled: !!recordId,
  });

  const isLoading = useMemo(() => {
    return createMutation.isPending || updateMutation.isPending;
  }, [createMutation.isPending, updateMutation.isPending]);

  useEffect(() => {
    if (record?.data && "id" in record.data) {
      form.setFieldValue("active", record.data.active);
      form.setFieldValue("name", record.data.name);
      //   form.setFieldValue("description", record.description);
      form.setFieldValue("phone", record.data.phone ?? "");
    }
  }, [record, form]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void form.handleSubmit();
      }}
      className="space-y-8"
    >
      <div className="space-y-2">
        <div>
          <Label>Активность</Label>
        </div>
        <form.Field name="active">
          {(field) => {
            return (
              <>
                <Switch
                  checked={field.getValue()}
                  onCheckedChange={field.setValue}
                />
              </>
            );
          }}
        </form.Field>
      </div>
      <div className="space-y-2">
        <div>
          <Label>Название</Label>
        </div>
        <form.Field name="name">
          {(field) => {
            return (
              <>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
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
          <Label>Телефон</Label>
        </div>
        <form.Field name="phone">
          {(field) => {
            return (
              <>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
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
      {/* <div className="space-y-2">
          <div>
            <Label>Описание</Label>
          </div>
          <form.Field name="description">
            {(field) => {
              return (
                <>
                  <Textarea
                    {...field.getInputProps()}
                    value={field.getValue() ?? ""}
                  />
                </>
              );
            }}
          </form.Field>
        </div> */}
      <Button type="submit" disabled={isLoading}>
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Submit
      </Button>
    </form>
  );
}
