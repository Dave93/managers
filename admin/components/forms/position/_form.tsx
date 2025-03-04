import { useToast } from "@admin/components/ui/use-toast";
import { Button } from "@admin/components/ui/button";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
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



export default function PositionsForm({
    setOpen,
    recordId,
}: {
    setOpen: (open: boolean) => void;
    recordId?: string;
}) {
    const formRef = useRef<HTMLFormElement | null>(null);
    const { toast } = useToast();
    const [changedTerminalId, setChangedTerminalId] = useState<Selection>(
        new Set([])
    );
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
        toast({
            title: "Error",
            description: error.message,
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
        onSuccess: () => onAddSuccess("updated"),
        onError,
    });

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
        { data: userTerminalsData, isLoading: isUserTerminalsLoading },

    ] = useQueries({
        queries: [
            {
                queryKey: ["one_position", recordId],
                queryFn: () => {
                    if (recordId) {
                        return apiClient.api.positions.get({
                            query: {
                                filters: JSON.stringify({ id: recordId })
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
            {
                enabled: !!recordId,
                queryKey: ["users_terminals", recordId],
                queryFn: async () => {
                    if (recordId) {
                        const { data } = await apiClient.api.users_terminals.get({
                            query: {
                                limit: "30",
                                offset: "0",
                                filters: JSON.stringify([
                                    {
                                        field: "user_id",
                                        operator: "=",
                                        value: recordId,
                                    },
                                ]),
                                fields: "terminal_id,user_id",
                            },
                        });
                        return data;
                    } else {
                        return null;
                    }
                },
            },
        ]
    });

    const isInitialLoading = isRecordLoading || isTerminalsLoading;

    const isLoading = useMemo(() => {
        return createMutation.isPending || updateMutation.isPending;
    }, [createMutation.isPending, updateMutation.isPending]);

    useEffect(() => {
        if (record?.data?.data?.[0]) {
            const position = record.data.data[0];
            form.setFieldValue("title", position.title as string);
            form.setFieldValue("description", position.description as string);
            form.setFieldValue("requirements", position.requirements as string);
            form.setFieldValue("salaryMin", position.salaryMin as number);
            form.setFieldValue("salaryMax", position.salaryMax as number);

            if (position.terminalId) {
                const terminalId = position.terminalId as string;
                setChangedTerminalId(new Set([terminalId]) as Selection);
                form.setFieldValue("terminalId", terminalId);
            }
        }
    }, [record, form]);

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
                                        field.handleChange(e.target.value);
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
                                        field.handleChange(e.target.value);
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
                                        field.handleChange(e.target.value);
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
            {/* <div>
                <div>
                    <Label>Филиалы</Label>
                </div>

                <Select
                    name="terminalId"
                    label="Филиалы"
                    selectionMode="single"
                    isMultiline={true}
                    placeholder="Выберите филиал"
                    selectedKeys={changedTerminalId}
                    classNames={{
                        base: "max-w-xs",
                        trigger: "min-h-unit-12 py-2",
                    }}
                    onSelectionChange={handleTerminalChange}
                    popoverProps={{
                        portalContainer: formRef.current!,
                        offset: 0,
                        containerPadding: 0,
                    }}
                    renderValue={(items: SelectedItems<string>) => {
                        return (
                            <div className="flex flex-wrap gap-2">
                                {Array.from(changedTerminalId).map((item) => (
                                    <Chip key={item}>{terminalLabelById[item]}</Chip>
                                ))}
                            </div>
                        );
                    }}
                >
                    {terminalsForSelect.map((terminal) => (
                        <SelectItem key={terminal.value} value={terminal.value}>
                            {terminal.label}
                        </SelectItem>
                    ))}
                </Select>
            </div> */}
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