import { toast } from "sonner";
import { Button } from "@admin/components/ui/buttonOrigin";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@components/ui/form";
import { Switch } from "@components/ui/switch";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition, useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import * as z from "zod";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { reports_status } from "@backend/../drizzle/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { InferInsertModel } from "drizzle-orm";

export default function ReportsStatusForm({
  setOpen,
  recordId,
}: {
  setOpen: (open: boolean) => void;
  recordId?: string;
}) {
  const queryClient = useQueryClient();

  // const form = useForm<z.infer<typeof PermissionsCreateInputSchema>>({
  //   resolver: zodResolver(PermissionsCreateInputSchema),
  //   defaultValues: {
  //     active: true,
  //     slug: "",
  //     description: "",
  //   },
  // });

  const onAddSuccess = (actionText: string) => {
    toast.success(`Reports status ${actionText}`);
    queryClient.invalidateQueries({ queryKey: ["reports_status"] });
    setOpen(false);
  };

  const onError = (error: any) => {
    toast.error(error.message);
  };

  const createMutation = useMutation({
    mutationFn: (newTodo: typeof reports_status.$inferInsert) => {
      return apiClient.api.reports_status.post({
        data: newTodo,
      });
    },
    onSuccess: () => onAddSuccess("added"),
    onError,
  });

  const updateMutation = useMutation({
    mutationFn: (newTodo: {
      data: typeof reports_status.$inferInsert;
      id: string;
    }) => {
      return apiClient.api.reports_status({ id: newTodo.id }).put({
        data: newTodo.data,
      });
    },
    onSuccess: () => onAddSuccess("updated"),
    onError,
  });

  const form = useForm({
    defaultValues: {
      label: "",
      code: "",
      color: "",
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
    queryKey: ["one_reports_status", recordId],
    queryFn: () => {
      if (recordId) {
        return apiClient.api.reports_status({ id: recordId }).get({});
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
      form.setFieldValue("label", record.data.label);
      form.setFieldValue("code", record.data.code);
      form.setFieldValue("color", record.data.color);
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
        className="space-y-8 mt-8"
      >
        <div className="space-y-2">
          <div>
            <Label>Названия Статуса</Label>
          </div>
          <form.Field name="label">
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
        <div className="space-y-2">
          <div>
            <Label>Цвет</Label>
          </div>
          <form.Field name="color">
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
