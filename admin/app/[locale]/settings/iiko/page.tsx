"use client";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@admin/components/ui/input";
import { Label } from "@admin/components/ui/label";
import { toast } from "sonner";
import { apiClient } from "@admin/utils/eden";
import { useForm } from "@tanstack/react-form";
import { Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";

export default function Page() {
  const onAddSuccess = (actionText: string) => {
    toast.success("Iiko settings saved");
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
              <Label>Ссылка</Label>
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
              <Label>Логин</Label>
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
              <Label>Пароль</Label>
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
            Save
          </Button>
        </form>
      </div>
    </div>
  );
}
