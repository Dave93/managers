import { useToast } from "@admin/components/ui/use-toast";
import { Button } from "@components/ui/button";
import { Switch } from "@components/ui/switch";

import { useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import * as z from "zod";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { Textarea } from "@admin/components/ui/textarea";
import { organization } from "backend/drizzle/schema";
import { InferInsertModel } from "drizzle-orm";
import useToken from "@admin/store/get-token";
import { apiClient } from "@admin/utils/eden";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";

export default function OrganizationsForm({
  setOpen,
  recordId,
}: {
  setOpen: (open: boolean) => void;
  recordId?: string;
}) {
  const { toast } = useToast();
  const token = useToken();
  const queryClient = useQueryClient();

  const onAddSuccess = (actionText: string) => {
    toast({
      title: "Success",
      description: `Organization ${actionText}`,
      duration: 5000,
    });
    queryClient.invalidateQueries({
      queryKey: ["organization"],
    });
    setOpen(false);
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
    mutationFn: (newTodo: InferInsertModel<typeof organization>) => {
      return apiClient.api.organization.post(
        {
          data: newTodo,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
    },
    onSuccess: () => onAddSuccess("added"),
    onError,
  });

  const updateMutation = useMutation({
    mutationFn: (newTodo: {
      data: InferInsertModel<typeof organization>;
      id: string;
    }) => {
      return apiClient.api.organization({ id: newTodo.id }).put(
        {
          data: newTodo.data,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
    },
    onSuccess: () => onAddSuccess("updated"),
    onError,
  });

  const form = useForm<InferInsertModel<typeof organization>>({
    defaultValues: {
      active: true,
      name: "",
      description: "",
      phone: "",
      code: "",
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
    queryKey: ["one_organization", recordId],
    queryFn: () => {
      if (recordId) {
        return apiClient.api.organization({ id: recordId }).get({
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      } else {
        return null;
      }
    },
    enabled: !!recordId && !!token,
  });

  const isLoading = useMemo(() => {
    return createMutation.isPending || updateMutation.isPending;
  }, [createMutation.isPending, updateMutation.isPending]);

  useEffect(() => {
    if (record?.data && "id" in record.data) {
      form.setFieldValue("active", record.data.active);
      form.setFieldValue("name", record.data.name);
      form.setFieldValue("description", record.data.description);
      form.setFieldValue("phone", record.data.phone);
      form.setFieldValue("code", record.data.code);
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
          <Label>Код</Label>
        </div>
        <form.Field name="code">
          {(field) => {
            return (
              <>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value ?? ""}
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
                  value={field.state.value ?? ""}
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
          <Label>Описание</Label>
        </div>
        <form.Field name="description">
          {(field) => {
            return (
              <>
                <Textarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value ?? ""}
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
