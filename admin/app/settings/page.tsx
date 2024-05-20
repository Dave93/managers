"use client";
import { CardContent } from "@admin/components/ui/card";
import { Button } from "@admin/components/ui/button";
import { useForm } from "@tanstack/react-form";
import { useToast } from "@admin/components/ui/use-toast";
import { Label } from "@admin/components/ui/label";
import { Input } from "@admin/components/ui/input";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import useToken from "@admin/store/get-token";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQuery } from "@tanstack/react-query";

export default function ConfigsPage() {
  const token = useToken();
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

  const { data: settings, isLoading: isSettingsLoading } = useQuery({
    enabled: !!token,
    queryKey: [
      "setting",
      {
        fields: "id,key,value",
        section: "main",
      },
    ],
    queryFn: async () => {
      const { data } = await apiClient.api.settings.get({
        query: {
          limit: "100",
          offset: "0",
          fields: "id,key,value",
          filters: encodeURIComponent(
            JSON.stringify([
              {
                field: "key",
                operator: "ilike",
                value: "main.%",
              },
            ])
          ),
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      return data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (newTodo: { key: string; value: string }) => {
      // @ts-ignore
      return apiClient.api.settings[newTodo.key].post({
        data: {
          value: newTodo.value,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    },
    onSuccess: () => onAddSuccess("added"),
    onError,
  });

  const form = useForm<{
    workStartTime: string;
    workEndTime: string;
  }>({
    defaultValues: {
      workStartTime: "",
      workEndTime: "",
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

  useEffect(() => {
    if (settings && settings.data && Array.isArray(settings.data)) {
      let workStartTime = settings!.data.find(
        (s) => s.key === "main.workStartTime"
      )?.value;
      let workEndTime = settings!.data.find(
        (s) => s.key === "main.workEndTime"
      )?.value;
      form.setFieldValue("workStartTime", workStartTime ?? "");
      form.setFieldValue("workEndTime", workEndTime ?? "");
    }
  }, [settings]);

  return (
    <CardContent>
      <div>
        <div className="flex justify-between">
          <h2 className="text-3xl font-bold tracking-tight">Основные</h2>
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
                <Label>Время начала рабочего дня</Label>
              </div>
              <form.Field name="workStartTime">
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
                <Label>Время окончания рабочего дня</Label>
              </div>
              <form.Field name="workEndTime">
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
    </CardContent>
  );
}
