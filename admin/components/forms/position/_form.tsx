import { toast } from "sonner";
import { Button } from "@admin/components/ui/buttonOrigin";
import { useMutation, useQueries } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { useForm } from "@tanstack/react-form";
import { useEffect, useMemo, useRef, useState } from "react";
import { Label } from "@admin/components/ui/label";
import { Input } from "@components/ui/input";
import { positions } from "backend/drizzle/schema";
import { Loader2 } from "lucide-react";
import { Selection } from "@react-types/shared";
import { useQueryClient } from "@tanstack/react-query";


type ApiData = {
    title: string;
    description?: string;
    requirements?: string;
    salaryMin?: number;
    salaryMax?: number;
    terminalId?: string;
};

type FormValues = {
    title: string;
    description: string;
    requirements: string;
    salaryMin: number;
    salaryMax: number;
    terminalId: string | undefined;
};

type Position = {
    id: string;
    title: string;
    description: string;
    requirements: string;
    salaryMin: number;
    salaryMax: number;
    terminalId: string;
};


export default function PositionsForm({
    setOpen,
    recordId,
}: {
    setOpen: (open: boolean) => void;
    recordId?: string;
}) {
    const formRef = useRef<HTMLFormElement>(null);
    const [changedTerminalId, setChangedTerminalId] = useState<Selection>(
        new Set([])
    );
    const queryClient = useQueryClient();
    const [isLoading, setIsLoading] = useState(false);
    const [, forceUpdate] = useState({});

    const onAddSuccess = (actionText: string) => {
        queryClient.invalidateQueries({ queryKey: ['positions'] });
        queryClient.invalidateQueries({ queryKey: ['positions_cached'] });
        toast.success(`Должность успешно ${actionText}`);
        setOpen(false);
    };

    const onError = (error: any) => {
        toast.error(error.message);
    };

    const createMutation = useMutation({
        mutationFn: (newTodo: typeof positions.$inferInsert) => {
            const data: ApiData = {
                title: newTodo.title,
                description: newTodo.description ?? undefined,
                requirements: newTodo.requirements ?? undefined,
                salaryMin: newTodo.salaryMin ?? undefined,
                salaryMax: newTodo.salaryMax ?? undefined,
                terminalId: newTodo.terminalId ?? undefined,
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
                terminalId: newTodo.data.terminalId ?? undefined,
            };
            return apiClient.api.positions({ id: newTodo.id }).put({
                data,

            });
        },
        onSuccess: () => onAddSuccess("обновлена"),
        onError,
    });

    // @ts-ignore
    const form = useForm<FormValues>({
        defaultValues: {
            title: "",
            description: "",
            requirements: "",
            salaryMin: 0,
            salaryMax: 0,
            terminalId: undefined,
        },
        onSubmit: async ({ value }) => {
            if (recordId) {
                updateMutation.mutate({ data: value, id: recordId });
            } else {
                createMutation.mutate(value);
            }
        },
    });

    const [
        { data: record, isLoading: isRecordLoading },
        { data: terminalsData, isLoading: isTerminalsLoading },
    ] = useQueries({
        queries: [
            {
                queryKey: ["one_position", recordId],
                queryFn: () => {
                    if (recordId) {
                        return apiClient.api.positions.get({
                            query: {
                                filters: JSON.stringify([
                                    { field: "id", operator: "eq", value: recordId }
                                ])
                            }
                        });
                    }
                    return null;
                },
                enabled: !!recordId,
            },
            {
                queryKey: ["terminals_cached"],
                queryFn: async () => {
                    const { data } = await apiClient.api.terminals.cached.get({});
                    return data;
                },
            },
        ]
    });

    const isInitialLoading = isRecordLoading || isTerminalsLoading;

    const isLoadingForm = useMemo(() => {
        return createMutation.isPending || updateMutation.isPending;
    }, [createMutation.isPending, updateMutation.isPending]);

    useEffect(() => {
        if (record?.data?.data?.[0]) {
            const position = record.data.data[0];
            console.log('Загруженные данные должности:', position);
            
            // Попытка установить значения через DOM
            setTimeout(() => {
                try {
                    // Найти и обновить поля формы напрямую
                    const titleInput = document.querySelector('input[name="title"]') as HTMLInputElement;
                    const descriptionInput = document.querySelector('input[name="description"]') as HTMLInputElement;
                    const requirementsInput = document.querySelector('input[name="requirements"]') as HTMLInputElement;
                    const salaryMinInput = document.querySelector('input[name="salaryMin"]') as HTMLInputElement;
                    const salaryMaxInput = document.querySelector('input[name="salaryMax"]') as HTMLInputElement;
                    
                    if (titleInput) {
                        titleInput.value = String(position.title || "");
                        // Вызвать событие изменения для обновления React-состояния
                        const event = new Event('input', { bubbles: true });
                        titleInput.dispatchEvent(event);
                    }
                    
                    if (descriptionInput) {
                        descriptionInput.value = String(position.description || "");
                        const event = new Event('input', { bubbles: true });
                        descriptionInput.dispatchEvent(event);
                    }
                    
                    if (requirementsInput) {
                        requirementsInput.value = String(position.requirements || "");
                        const event = new Event('input', { bubbles: true });
                        requirementsInput.dispatchEvent(event);
                    }
                    
                    if (salaryMinInput) {
                        salaryMinInput.value = String(position.salaryMin || 0);
                        const event = new Event('input', { bubbles: true });
                        salaryMinInput.dispatchEvent(event);
                    }
                    
                    if (salaryMaxInput) {
                        salaryMaxInput.value = String(position.salaryMax || 0);
                        const event = new Event('input', { bubbles: true });
                        salaryMaxInput.dispatchEvent(event);
                    }
                    
                    console.log('Значения установлены через DOM');
                } catch (error) {
                    console.error('Ошибка при установке значений через DOM:', error);
                }
            }, 100); // Даем время на рендеринг формы
            
            if (position.terminalId) {
                const terminalId = String(position.terminalId);
                console.log('Установка terminalId:', terminalId);
                setChangedTerminalId(new Set([terminalId]) as Selection);
            }
        }
    }, [record, form]);

    useEffect(() => {
        if (recordId) {
            // Данные уже загружаются через useQueries выше
            // Не нужно дублировать запрос и показывать дополнительный лоадер
        }
    }, [recordId]);

    const terminalsForSelect = useMemo(() => {
        return terminalsData && Array.isArray(terminalsData)
            ? terminalsData.map((item) => ({
                value: item.id,
                label: item.name,
            }))
            : [];
    }, [terminalsData]);

    const terminalLabelById = useMemo(() => {
        return terminalsData && Array.isArray(terminalsData)
            ? terminalsData.reduce((acc, item) => {
                acc[item.id] = item.name;
                return acc;
            }, {} as { [key: string]: string })
            : {};
    }, [terminalsData]);

    const handleTerminalChange = (selection: Selection) => {
        setChangedTerminalId(selection);
        const selectedTerminal = Array.from(selection)[0] as string | undefined;
        form.setFieldValue("terminalId", () => selectedTerminal);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>, field: any) => {
        const { name, value, type } = e.target;
        const newValue = type === 'number' ? Number(value) : value;
        
        field.handleChange(newValue);
    };

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
            className="space-y-8 p-4"
        >
            <div>
                <div>
                    <Label>Название Должность</Label>
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
                                    onChange={(e) => {
                                        handleChange(e, field);
                                    }}
                                />
                            </>
                        )
                    }
                    }
                </form.Field>
            </div>
            <div>
                <div>
                    <Label>Описание Должность</Label>
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
                                        handleChange(e, field);
                                    }}
                                />
                            </>
                        )
                    }
                    }
                </form.Field>
            </div>
            <div>
                <div>
                    <Label>Требование</Label>
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
                                        handleChange(e, field);
                                    }}
                                />
                            </>
                        )
                    }
                    }
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
                                    handleChange(e, field);
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
                                    handleChange(e, field);
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
                <Button type="submit" disabled={isLoadingForm}>
                    {isLoadingForm && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {recordId ? 'Сохранить' : 'Создать'}
                </Button>
            </div>
        </form>
    )
}