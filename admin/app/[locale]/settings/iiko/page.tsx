"use client";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import { toast } from "sonner";
import { apiClient } from "@admin/utils/eden";
import { useForm } from "@tanstack/react-form";
import { Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

export default function Page() {
  const t = useTranslations("settingsPage");
  const onAddSuccess = (actionText: string) => {
    toast.success(t("iikoSaved"));
  };

  const onError = (error: any) => {
    toast.error(error.message);
  };

  const createMutation = useMutation({
    mutationFn: (newTodo: { key: string; value: string }) => {
      // @ts-ignore
      return apiClient.api.settings[newTodo.key].post({
        data: {
          value: newTodo.value,
        },
      });
    },
    onSuccess: () => onAddSuccess("added"),
    onError,
  });

  // @ts-ignore
  const form = useForm<{
    login: string;
    password: string;
    api_url: string;
  }>({
    defaultValues: {
      login: "",
      password: "",
      api_url: "",
    },
    onSubmit: async ({ value }) => {
      Object.keys(value).forEach((key) => {
        const valueKey = key as keyof typeof value;
        createMutation.mutate({
          key: `main.${key}`,
          value: value[valueKey],
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
              <Label>{t("iiko.url")}</Label>
            </div>
            <form.Field name="api_url">
              {(field) => {
                return (
                  <>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.getValue() ?? ""}
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
              <Label>{t("iiko.login")}</Label>
            </div>
            <form.Field name="login">
              {(field) => {
                return (
                  <>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.getValue() ?? ""}
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
              <Label>{t("iiko.password")}</Label>
            </div>
            <form.Field name="password">
              {(field) => {
                return (
                  <>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.getValue() ?? ""}
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
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {t("save")}
          </Button>
        </form>
      </div>
    </div>
  );
}
