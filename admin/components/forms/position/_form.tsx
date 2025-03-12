import { useToast } from "@admin/components/ui/use-toast";
import { Button } from "@admin/components/ui/buttonOrigin";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { useForm } from "@tanstack/react-form";
import { useEffect, useMemo, useRef } from "react";
import { Label } from "@admin/components/ui/label";
import { Input } from "@components/ui/input";
import { positions } from "backend/drizzle/schema";
import { Loader2 } from "lucide-react";

import { useQueryClient } from "@tanstack/react-query";

type ApiData = {
    title: string;
    description?: string;
    requirements?: string;
    salaryMin?: number;
    salaryMax?: number;
};

type FormValues = {
    title: string;
    description: string;
    requirements: string;
    salaryMin: number;
    salaryMax: number;
};



export default function PositionsForm({
    setOpen,
    recordId,
}: {
    setOpen: (open: boolean) => void;
    recordId?: string;
}) {
    const formRef = useRef<HTMLFormElement | null>(null);
    const { toast } = useToast();

    const queryClient = useQueryClient();

    const onAddSuccess = (actionText: string) => {
        queryClient.invalidateQueries({ queryKey: ['positions'] });
        queryClient.invalidateQueries({ queryKey: ['positions_cached'] });
        toast({
            title: "Успешно",
            description: `Должность успешно ${actionText}`,
            duration: 5000,
        });
        setOpen(false);
    };

    const onError = (error: any) => {
        const errorMessage = error?.message || "Произошла неизвестная ошибка";
        toast({
            title: "Ошибка",
            description: errorMessage,
            variant: "destructive",
            duration: 5000
        });
    };

    const createMutation = useMutation({
        mutationFn: (newTodo: typeof positions.$inferInsert) => {
            const data: ApiData = {
                title: newTodo.title,
                description: newTodo.description ?? undefined,
                requirements: newTodo.requirements ?? undefined,
                salaryMin: newTodo.salaryMin ?? undefined,
                salaryMax: newTodo.salaryMax ?? undefined,
            };
            return apiClient.api.positions.post({
                data,
            });
        },
        onSuccess: () => onAddSuccess('добавлена'),
        onError,
    });

    const updateMutation = useMutation({
        mutationFn: (newTodo: {
            data: typeof positions.$inferInsert;
            id: string;
        }) => {
            const data: ApiData = {
                title: newTodo.data.title,
                description: newTodo.data.description ?? undefined,
                requirements: newTodo.data.requirements ?? undefined,
                salaryMin: newTodo.data.salaryMin ?? undefined,
                salaryMax: newTodo.data.salaryMax ?? undefined,
            };
            return apiClient.api.positions({ id: newTodo.id }).put({
                data,

            });
        },
        onSuccess: () => onAddSuccess("обновлена"),
        onError,
    });

    const { data: record, isLoading: isRecordLoading } = useQuery({
        queryKey: ["one_position", recordId],
        queryFn: async () => {
            if (!recordId) return null;

            console.log("Fetching position with ID", recordId);

            try {
                // Пробуем получить данные напрямую по ID
                const response = await apiClient.api.positions({ id: recordId }).get();
                console.log("Direct ID fetch response", response);
                return response;
            } catch (error) {
                console.log("Error fetching by direct ID, trying with filters", error);

                try {
                    // Если прямой запрос не сработал, пробуем через фильтры
                    const response = await apiClient.api.positions.get({
                        query: {
                            filters: JSON.stringify([
                                {
                                    field: "id",
                                    operator: "=",
                                    value: recordId
                                }
                            ])
                        }
                    });
                    console.log("Filter fetch response", response);
                    return response;
                } catch (filterError) {
                    console.log("Error fetching with filters", filterError);
                    throw filterError;
                }
            }
        },
        enabled: !!recordId,
        staleTime: 0, // Disable caching to always get fresh data
        refetchOnWindowFocus: false,
        refetchOnMount: true, // Always refetch when component mounts
        retry: 3, // Retry failed requests 3 times
        retryDelay: 1000, // Wait 1 second between retries
    });



    const isInitialLoading = isRecordLoading;

    const isLoading = useMemo(() => {
        return createMutation.isPending || updateMutation.isPending;
    }, [createMutation.isPending, updateMutation.isPending]);

    const form = useForm<FormValues>({
        defaultValues: {
            title: "",
            description: "",
            requirements: "",
            salaryMin: 0,
            salaryMax: 0,
        },
        onSubmit: async ({ value }) => {
            if (recordId) {
                updateMutation.mutate({ data: value, id: recordId });
            } else {
                createMutation.mutate(value);
            }
        },
    });

    // We don't need to reset the form when recordId changes
    // This was causing the form to reset before data was loaded

    // Update form values when record data is loaded
    useEffect(() => {
        if (!record) return;

        console.log("Setting form values from record:", record);

        // Safely extract position data from various response formats
        const extractPosition = (data: any) => {
            if (!data) return null;

            console.log("Extracting position from data:", JSON.stringify(data));

            // Handle different response formats
            if (data.data) {
                if (Array.isArray(data.data) && data.data.length > 0) {
                    console.log("Found position in array data[0]:", data.data[0]);
                    return data.data[0];
                } else if (typeof data.data === 'object') {
                    console.log("Found position in object data:", data.data);
                    return data.data;
                }
            } else if (data.id) {
                // Direct object with id
                console.log("Found position with direct id:", data);
                return data;
            }

            console.log("Using data directly as position:", data);
            return data;
        };

        const position = extractPosition(record);
        console.log("Extracted position:", position);

        if (position) {
            // First reset the form to clear any previous values
            form.reset();

            // Устанавливаем значения с проверкой на undefined
            const formValues = {
                title: position.title || "",
                description: position.description || "",
                requirements: position.requirements || "",
                salaryMin: Number(position.salaryMin) || 0,
                salaryMax: Number(position.salaryMax) || 0
            };

            console.log("Setting form values:", formValues);

            // Use setTimeout to ensure the form has been reset before setting new values
            setTimeout(() => {
                // Устанавливаем значения формы
                Object.entries(formValues).forEach(([key, value]) => {
                    form.setFieldValue(key as keyof FormValues, value);
                });

                // Проверка, что значения установлены
                setTimeout(() => {
                    const currentValues = {
                        title: form.getFieldValue("title"),
                        description: form.getFieldValue("description"),
                        requirements: form.getFieldValue("requirements"),
                        salaryMin: form.getFieldValue("salaryMin"),
                        salaryMax: form.getFieldValue("salaryMax")
                    };
                    console.log("Form values after setting:", currentValues);
                }, 100);
            }, 0);
        }
    }, [record, form]);

    if (isInitialLoading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <form
            ref={formRef}
            onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void form.handleSubmit()
            }}
            className="space-y-8"
        >
            <div>
                <div>
                    <Label>Название должности</Label>
                </div>
                <form.Field name="title">
                    {(field) => {
                        return (
                            <>
                                <Input
                                    id={field.name}
                                    name={field.name}
                                    value={field.state.value}
                                    onBlur={field.handleBlur}
                                    onChange={(e) => field.handleChange(e.target.value)}
                                />
                            </>
                        );
                    }}
                </form.Field>
            </div>
            <div>
                <div>
                    <Label>Описание должности</Label>
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
                                        field.handleChange(e.target.value);
                                    }}

                                />
                            </>
                        );
                    }}
                </form.Field>
            </div>
            <div>
                <div>
                    <Label>Требования</Label>
                </div>
                <form.Field name="requirements">
                    {(field) => {
                        return (
                            <>
                                <Input
                                    id={field.name}
                                    name={field.name}
                                    value={field.state.value}
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
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <div>
                        <Label>Минимальная зарплата</Label>
                    </div>
                    <form.Field name="salaryMin">
                        {(field) => (
                            <Input
                                type="number"
                                id={field.name}
                                name={field.name}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) => {
                                    field.handleChange(Number(e.target.value));
                                }}
                            />
                        )}
                    </form.Field>
                </div>

                <div className="space-y-2">
                    <div>
                        <Label>Максимальная зарплата</Label>
                    </div>
                    <form.Field name="salaryMax">
                        {(field) => (
                            <Input
                                type="number"
                                id={field.name}
                                name={field.name}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) => {
                                    field.handleChange(Number(e.target.value));
                                }}
                            />
                        )}
                    </form.Field>
                </div>
            </div>
            <div className="flex justify-end space-x-4">
                <Button
                    variant="outline"
                    onClick={() => setOpen(false)}
                    type="button"
                >
                    Отмена
                </Button>
                <Button type="submit" disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {recordId ? 'Сохранить' : 'Создать'}
                </Button>
            </div>
        </form>
    )
}