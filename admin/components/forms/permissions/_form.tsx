import { useToast } from "@admin/components/ui/use-toast";
import { Button } from "@components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@components/ui/form";
import { Switch } from "@components/ui/switch";
import ReactDOM from "react-dom/client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition, useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import * as z from "zod";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { permissions } from "@backend/../drizzle/schema";
import { InferInsertModel } from "drizzle-orm";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import useToken from "@admin/store/get-token";

export default function PermissionsForm({
  setOpen,
  recordId,
}: {
  setOpen: (open: boolean) => void;
  recordId?: string;
}) {
  const token = useToken();
  const { toast } = useToast();

  // const form = useForm<z.infer<typeof PermissionsCreateInputSchema>>({
  //   resolver: zodResolver(PermissionsCreateInputSchema),
  //   defaultValues: {
  //     active: true,
  //     slug: "",
  //     description: "",
  //   },
  // });

  const onAddSuccess = (actionText: string) => {
    toast({
      title: "Success",
      description: `Permission ${actionText}`,
      duration: 5000,
    });
    // form.reset();
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
    mutationFn: (newTodo: InferInsertModel<typeof permissions>) => {
      return apiClient.api.permissions.post(
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
      data: InferInsertModel<typeof permissions>;
      id: string;
    }) => {
      return apiClient.api.permissions({ id: newTodo.id }).put(
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

  const form = useForm<InferInsertModel<typeof permissions>>({
    defaultValues: {
      active: true,
      slug: "",
      description: "",
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
    queryKey: ["one_permission", recordId],
    queryFn: () => {
      if (recordId) {
        return apiClient.api.permissions({ id: recordId }).get({
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
      form.setFieldValue("slug", record.data.slug);
      form.setFieldValue("description", record.data.description);
    }
  }, [record]);

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
            <Label>Код</Label>
          </div>
          <form.Field name="slug">
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
            <Label>Описание</Label>
          </div>
          <form.Field name="description">
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
