import { useToast } from "@admin/components/ui/use-toast";
import {
  useCredentialsCreate,
  useCredentialsUpdate,
} from "@admin/store/apis/credentials";
import { Button } from "@components/ui/button";
import { trpc } from "@admin/utils/trpc";
import { CredentialsCreateInputSchema } from "@backend/lib/zod";
import { useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import * as z from "zod";
import { createFormFactory } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";

const formFactory = createFormFactory<
  z.infer<typeof CredentialsCreateInputSchema>
>({
  defaultValues: {
    model: "",
    model_id: "",
    type: "",
    key: "",
  },
});

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
      description: `Credential ${actionText}`,
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
    mutateAsync: createCredential,
    isLoading: isAddLoading,
    data,
    error,
  } = useCredentialsCreate({
    onSuccess: () => onAddSuccess("added"),
    onError,
  });

  const {
    mutateAsync: updateCredential,
    isLoading: isUpdateLoading,
    error: updateError,
  } = useCredentialsUpdate({
    onSuccess: () => onAddSuccess("updated"),
    onError,
  });

  const form = formFactory.useForm({
    onSubmit: async (values, formApi) => {
      if (credentialId) {
        updateCredential({
          data: { ...values, model: model, model_id: recordId },
          where: { id: credentialId },
        });
      } else {
        createCredential({
          data: { ...values, model: model, model_id: recordId },
        });
      }
    },
  });

  const { data: record, isLoading: isRecordLoading } =
    trpc.credentials.one.useQuery(
      {
        where: { id: credentialId },
      },
      {
        enabled: !!credentialId,
      }
    );

  const isLoading = useMemo(() => {
    return isAddLoading || isUpdateLoading;
  }, [isAddLoading, isUpdateLoading]);

  useEffect(() => {
    if (record) {
      form.setFieldValue("key", record.key);
      form.setFieldValue("type", record.type);
      form.setFieldValue("model", record.model);
      form.setFieldValue("model_id", record.model_id);
    }
  }, [record, form]);

  return (
    <form.Provider>
      <form {...form.getFormProps()} className="space-y-8">
        <div className="space-y-2">
          <div>
            <Label>Ключ</Label>
          </div>
          <form.Field name="key">
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
            <Label>Тип</Label>
          </div>
          <form.Field name="type">
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
