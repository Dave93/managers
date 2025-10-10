import { toast } from "sonner";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Switch } from "@components/ui/switch";
import { useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { externalPartners } from "@backend/../drizzle/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";

export default function ExternalPartnersForm({
  setOpen,
  recordId,
}: {
  setOpen: (open: boolean) => void;
  recordId?: string;
}) {
  const queryClient = useQueryClient();

  const onAddSuccess = (actionText: string) => {
    toast.success(`External Partner ${actionText}`);
    queryClient.invalidateQueries({ queryKey: ["external_partners"] });
    setOpen(false);
  };

  const onError = (error: any) => {
    toast.error(error.message);
  };

  const createMutation = useMutation({
    mutationFn: (newPartner: typeof externalPartners.$inferInsert) => {
      return apiClient.api.external_partners.post({
        data: newPartner,
      });
    },
    onSuccess: () => onAddSuccess("added"),
    onError,
  });

  const updateMutation = useMutation({
    mutationFn: (data: {
      data: typeof externalPartners.$inferInsert;
      id: string;
    }) => {
      return apiClient.api.external_partners({ id: data.id }).put({
        data: data.data,
      });
    },
    onSuccess: () => onAddSuccess("updated"),
    onError,
  });

  const { data: record, isLoading: isRecordLoading } = useQuery({
    queryKey: ["one_external_partner", recordId],
    queryFn: () => {
      if (recordId) {
        return apiClient.api.external_partners({ id: recordId }).get({});
      } else {
        return null;
      }
    },
    enabled: !!recordId,
  });

  const form = useForm({
    defaultValues: {
      is_active: true,
      name: "",
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      if (recordId) {
        updateMutation.mutate({ data: value, id: recordId });
      } else {
        createMutation.mutate(value);
      }
    },
  });

  const isLoading = useMemo(() => {
    return createMutation.isPending || updateMutation.isPending;
  }, [createMutation.isPending, updateMutation.isPending]);

  // Reset form when recordId changes or when opening for creation
  useEffect(() => {
    if (!recordId) {
      // Reset to default values for creation
      form.reset();
    }
  }, [recordId, form]);

  // Populate form with record data when editing
  useEffect(() => {
    if (record && recordId && "id" in record.data) {
      console.log("Updating form with:", {
        is_active: record.data.is_active,
        name: record.data.name,
        email: record.data.email,
      });

      form.reset({
        is_active: record.data.is_active ?? true,
        name: record.data.name ?? "",
        email: record.data.email ?? "",
        password: "",
      });
    }
  }, [record, recordId, form]);

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
            <Label>Активность</Label>
          </div>
          <form.Field name="is_active">
            {(field) => {
              return (
                <>
                  <Switch
                    checked={field.getValue() ?? false}
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
            <Label>Email</Label>
          </div>
          <form.Field name="email">
            {(field) => {
              return (
                <>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    value={field.state.value ?? ""}
                    onBlur={field.handleBlur}
                    onChange={(e) => {
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
                    type="password"
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
    </div>
  );
}
