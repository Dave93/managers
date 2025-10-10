import { toast } from "sonner";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Switch } from "@components/ui/switch";
import { useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import * as z from "zod";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { InferInsertModel } from "drizzle-orm";
import { roles } from "backend/drizzle/schema";

export default function RolesForm({
  setOpen,
  recordId,
}: {
  setOpen: (open: boolean) => void;
  recordId?: string;
}) {
  const queryClient = useQueryClient();

  const onAddSuccess = (actionText: string) => {
    toast.success(`Role ${actionText}`);
    queryClient.invalidateQueries({ queryKey: ["roles"] });
    setOpen(false);
  };

  const onError = (error: any) => {
    toast.error(error.message);
  };

  const createMutation = useMutation({
    mutationFn: (newTodo: typeof roles.$inferInsert) => {
      return apiClient.api.roles.post({
        data: newTodo,
      });
    },
    onSuccess: () => onAddSuccess("added"),
    onError,
  });

  const updateMutation = useMutation({
    mutationFn: (newTodo: {
      data: typeof roles.$inferInsert;
      id: string;
    }) => {
      return apiClient.api.roles({ id: newTodo.id }).put({
        data: newTodo.data,
      });
    },
    onSuccess: () => onAddSuccess("updated"),
    onError,
  });

  // @ts-ignore
  const form = useForm<{
    active: boolean;
    name: string;
    code: string;
  }>({
    defaultValues: {
      active: true,
      name: "",
      code: "",
    },
    onSubmit: async ({ value, formApi }) => {
      if (recordId) {
        updateMutation.mutate({ data: value, id: recordId });
      } else {
        createMutation.mutate(value);
      }
    },
  });

  const { data: record, isLoading: isRecordLoading } = useQuery({
    queryKey: ["one_role", recordId],
    queryFn: () => {
      if (recordId) {
        return apiClient.api.roles({ id: recordId }).get({});
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
      form.setFieldValue("code", record.data?.code ?? "");
    }
  }, [record]);

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
          <Label>Код</Label>
        </div>
        <form.Field name="code">
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
      <Button type="submit" disabled={isLoading}>
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Submit
      </Button>
    </form>
  );
}
