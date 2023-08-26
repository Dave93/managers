"use client";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import { useToast } from "@admin/components/ui/use-toast";
import { useSettingsSet } from "@admin/store/apis/settings";
import { createFormFactory } from "@tanstack/react-form";
import { Loader2 } from "lucide-react";

const formFactory = createFormFactory<{
  login: string;
  password: string;
  api_url: string;
}>({
  defaultValues: {
    login: "",
    password: "",
    api_url: "",
  },
});

export default function Page() {
  const { toast } = useToast();

  const onAddSuccess = (actionText: string) => {
    toast({
      title: "Success",
      description: "Iiko settings saved",
      duration: 5000,
    });
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
    mutateAsync: createOrUpdateSettings,
    isLoading: isAddLoading,
    data,
    error,
  } = useSettingsSet({
    onSuccess: () => onAddSuccess("added"),
    onError,
  });

  const form = formFactory.useForm({
    onSubmit: async (values, formApi) => {
      Object.keys(values).forEach((key) => {
        const valueKey = key as keyof typeof values;
        createOrUpdateSettings({
          where: {
            key: `iiko.${key}`,
          },
          update: {
            value: values[valueKey],
            key: `iiko.${key}`,
            is_secure: true,
          },
          create: {
            value: values[valueKey],
            key: `iiko.${key}`,
            is_secure: true,
          },
        });
      });
    },
  });

  return (
    <div>
      <div className="flex justify-between">
        <h2 className="text-3xl font-bold tracking-tight">IIKO</h2>
      </div>
      <div className="py-10">
        <form.Provider>
          <form {...form.getFormProps()} className="space-y-8">
            <div className="space-y-2">
              <div>
                <Label>Ссылка</Label>
              </div>
              <form.Field name="api_url">
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
                <Label>Логин</Label>
              </div>
              <form.Field name="login">
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
                <Label>Пароль</Label>
              </div>
              <form.Field name="password">
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
            <Button type="submit" disabled={isAddLoading}>
              {isAddLoading && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Save
            </Button>
          </form>
        </form.Provider>
      </div>
    </div>
  );
}
