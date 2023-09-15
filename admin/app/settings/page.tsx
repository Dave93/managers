"use client";
import { CardContent } from "@admin/components/ui/card";
import { Button } from "@admin/components/ui/button";
import { createFormFactory } from "@tanstack/react-form";
import { useSettingsQuery, useSettingsSet } from "@admin/store/apis/settings";
import { useToast } from "@admin/components/ui/use-toast";
import { Label } from "@admin/components/ui/label";
import { Input } from "@admin/components/ui/input";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

const formFactory = createFormFactory<{
  workStartTime: string;
  workEndTime: string;
}>({
  defaultValues: {
    workStartTime: "",
    workEndTime: "",
  },
});

export default function ConfigsPage() {
  const { toast } = useToast();

  const onAddSuccess = (actionText: string) => {
    toast({
      title: "Success",
      description: "Main settings saved",
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

  const { data: settings, isLoading: isSettingsLoading } = useSettingsQuery({
    where: {
      key: {
        startsWith: "main.",
      },
    },
  });

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
            key: `main.${key}`,
          },
          update: {
            value: values[valueKey],
            key: `main.${key}`,
          },
          create: {
            value: values[valueKey],
            key: `main.${key}`,
          },
        });
      });
    },
  });

  useEffect(() => {
    if (settings) {
      form.setFieldValue(
        "workStartTime",
        settings.items.find((s) => s.key === "main.workStartTime")?.value
      );
      form.setFieldValue(
        "workEndTime",
        settings.items.find((s) => s.key === "main.workEndTime")?.value
      );
    }
  }, [settings]);

  return (
    <CardContent>
      <div>
        <div className="flex justify-between">
          <h2 className="text-3xl font-bold tracking-tight">Основные</h2>
        </div>
        <div className="py-10">
          <form.Provider>
            <form {...form.getFormProps()} className="space-y-8">
              <div className="space-y-2">
                <div>
                  <Label>Дата начала рабочего дня</Label>
                </div>
                <form.Field name="workStartTime">
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
                  <Label>Дата окончания рабочего дня</Label>
                </div>
                <form.Field name="workEndTime">
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
    </CardContent>
  );
}
