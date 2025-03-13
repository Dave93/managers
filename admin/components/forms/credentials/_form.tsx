import { toast } from "sonner";
import { Button } from "@admin/components/ui/buttonOrigin";

import { useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import * as z from "zod";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { credentials } from "@backend/../drizzle/schema";
import { InferInsertModel } from "drizzle-orm";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";

export default function CredentialsAddForm({
  setOpen,
  recordId,
  model,
  credentialId,
}: {
  setOpen: (open: boolean) => void;
  recordId: string;
  model: string;
  credentialId?: string;
}) {
  const queryClient = useQueryClient();

  const onAddSuccess = (actionText: string) => {
    toast.success(`Credential ${actionText}`);
    queryClient.invalidateQueries({
      queryKey: ["credentials"],
    });
    setOpen(false);
  };

  const onError = (error: any) => {
    toast.error(error.message);
  };

  const createMutation = useMutation({
    mutationFn: (newTodo: typeof credentials.$inferInsert) => {
      return apiClient.api.credentials.post({
        data: newTodo,
      });
    },
    onSuccess: () => onAddSuccess("added"),
    onError,
  });

  const updateMutation = useMutation({
    mutationFn: (newTodo: {
      data: typeof credentials.$inferInsert;
      id: string;
    }) => {
      return apiClient.api.credentials({ id: newTodo.id }).put({
        data: newTodo.data,
      });
    },
    onSuccess: () => onAddSuccess("updated"),
    onError,
  });

  const form = useForm<typeof credentials.$inferInsert>({
    defaultValues: {
      model: "",
      model_id: "",
      type: "",
      key: "",
    },
    onSubmit: async ({ value }) => {
      if (credentialId) {
        updateMutation.mutate({
          data: { ...value, model: model, model_id: recordId },
          id: credentialId,
        });
      } else {
        createMutation.mutate({
          ...value,
          model: model,
          model_id: recordId,
        });
      }
    },
  });

  const { data: record, isLoading: isRecordLoading } = useQuery({
    queryKey: ["one_credential", credentialId],
    queryFn: () => {
      if (credentialId) {
        return apiClient.api.credentials({ id: credentialId }).get({});
      } else {
        return null;
      }
    },
    enabled: !!credentialId,
  });

  const isLoading = useMemo(() => {
    return createMutation.isPending || updateMutation.isPending;
  }, [createMutation.isPending, updateMutation.isPending]);

  useEffect(() => {
    if (record?.data && "id" in record.data) {
      form.setFieldValue("key", record.data.key);
      form.setFieldValue("type", record.data.type);
      form.setFieldValue("model", record.data.model);
      form.setFieldValue("model_id", record.data.model_id);
    }
  }, [record, form]);

  return (
    <div>
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
            <Label>Ключ</Label>
          </div>
          <form.Field name="key">
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
            <Label>Тип</Label>
          </div>
          <form.Field name="type">
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
    </div>
  );
}
