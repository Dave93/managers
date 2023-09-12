import { useToast } from "@admin/components/ui/use-toast";
import {
  useReportsStatusCreate,
  useReportsStatusUpdate,
} from "@admin/store/apis/reports_status";
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
import { trpc } from "@admin/utils/trpc";
import { Reports_statusCreateInputSchema } from "@backend/lib/zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTransition, useMemo, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";
import * as z from "zod";
import {
  FieldApi,
  FormApi,
  createFormFactory,
  useField,
} from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";

const formFactory = createFormFactory<
  z.infer<typeof Reports_statusCreateInputSchema>
>({
  defaultValues: {
    label: "",
    code: "",
    color: "",
  },
});

export default function ReportsStatusForm({
  setOpen,
  recordId,
}: {
  setOpen: (open: boolean) => void;
  recordId?: string;
}) {
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
      description: `Reports status ${actionText}`,
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

  const {
    mutateAsync: createReportsStatus,
    isLoading: isAddLoading,
    data,
    error,
  } = useReportsStatusCreate({
    onSuccess: () => onAddSuccess("added"),
    onError,
  });

  const {
    mutateAsync: updateReportsStatus,
    isLoading: isUpdateLoading,
    error: updateError,
  } = useReportsStatusUpdate({
    onSuccess: () => onAddSuccess("updated"),
    onError,
  });

  const form = formFactory.useForm({
    onSubmit: async (values, formApi) => {
      if (recordId) {
        updateReportsStatus({ data: values, where: { id: recordId } });
      } else {
        createReportsStatus({ data: values });
      }
    },
  });

  const { data: record, isLoading: isRecordLoading } =
    trpc.reportsStatus.one.useQuery(
      {
        where: { id: recordId },
      },
      {
        enabled: !!recordId,
      }
    );

  const isLoading = useMemo(() => {
    return isAddLoading || isUpdateLoading;
  }, [isAddLoading, isUpdateLoading]);

  useEffect(() => {
    if (record) {
      form.setFieldValue("label", record.label);
      form.setFieldValue("code", record.code);
      form.setFieldValue("color", record.color);
    }
  }, [record]);

  return (
    <form.Provider>
      <form {...form.getFormProps()} className="space-y-8 mt-8">
        <div className="space-y-2">
          <div>
            <Label>Названия Статуса</Label>
          </div>
          <form.Field name="label">
            {(field) => {
              return (
                <>
                  <Input
                    {...field.getInputProps()}
                    value={field.getValue() ?? ""}
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
                    {...field.getInputProps()}
                    value={field.getValue() ?? ""}
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
                    {...field.getInputProps()}
                    value={field.getValue() ?? ""}
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
    </form.Provider>
  );
}
