import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { work_schedules } from "backend/drizzle/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@admin/components/ui/use-toast";
import { apiClient } from "@admin/utils/eden";
import { useForm } from "@tanstack/react-form";
import { Loader2, Check } from "lucide-react";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Badge } from "@components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@components/ui/select";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
} from "@components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@components/ui/popover";
import { cn } from "@admin/lib/utils";

type WorkSchedule = {
    id: string;
    name: string;
    active: boolean;
    organization_id: string;
    days: string[];
    start_time: string;
    end_time: string;
    max_start_time: string;
    bonus_price: number;
};


const daysWeek = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

type ApiData = {
    name: string;
    active?: boolean | undefined;
    organization_id: string;
    days: string[];
    start_time: string;
    end_time: string;
    max_start_time: string;
    bonus_price: number;
}

type FormValues = {
    name: string;
    active: boolean;
    organization_id: string;
    days: string[];
    start_time: string;
    end_time: string;
    max_start_time: string;
    bonus_price: number;
}


export default function WorkScheduleForm({
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
        queryClient.invalidateQueries({ queryKey: ['work_schedules'] });
        queryClient.invalidateQueries({ queryKey: ['work_schedules_cached'] });
        toast({
            title: "Успешно",
            description: `График Работ успешно ${actionText}`,
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
        mutationFn: (newTodo: typeof work_schedules.$inferInsert) => {
            if (!newTodo.organization_id) {
                throw new Error("Пожалуйста, выберите организацию");
            }
            const data: ApiData = {
                name: newTodo.name,
                active: newTodo.active || false,
                organization_id: newTodo.organization_id,
                days: newTodo.days || [],
                start_time: newTodo.start_time,
                end_time: newTodo.end_time,
                max_start_time: newTodo.max_start_time,
                bonus_price: newTodo.bonus_price || 0,
            };
            return apiClient.api.work_schedule.post({
                data,
            })
        },
        onSuccess: () => onAddSuccess('Added'),
        onError,
    });

    const updateMutation = useMutation({
        mutationFn: (newTodo: {
            data: typeof work_schedules.$inferInsert;
            id: string;
        }) => {
            if (!newTodo.data.organization_id) {
                throw new Error("Пожалуйста, выберите организацию");
            }
            const data: ApiData = {
                name: newTodo.data.name,
                active: newTodo.data.active || false,
                organization_id: newTodo.data.organization_id,
                days: newTodo.data.days || [],
                start_time: newTodo.data.start_time,
                end_time: newTodo.data.end_time,
                max_start_time: newTodo.data.max_start_time,
                bonus_price: newTodo.data.bonus_price || 0,
            };
            return apiClient.api.work_schedule({ id: newTodo.id }).put({
                data,
            });
        },
        onSuccess: () => onAddSuccess("updated"),
        onError,
    });

    const form = useForm<FormValues>({
        defaultValues: {
            name: "",
            active: false,
            organization_id: "",
            days: [],
            start_time: "",
            end_time: "",
            max_start_time: "",
            bonus_price: 0,
        },
        onSubmit: async ({ value }) => {
            try {
                if (!value.organization_id) {
                    throw new Error("Пожалуйста, выберите организацию");
                }
                if (!value.name) {
                    throw new Error("Пожалуйста, введите название графика");
                }
                if (!value.days || value.days.length === 0) {
                    throw new Error("Пожалуйста, выберите рабочие дни");
                }
                if (!value.start_time) {
                    throw new Error("Пожалуйста, укажите время начала работы");
                }
                if (!value.end_time) {
                    throw new Error("Пожалуйста, укажите время окончания работы");
                }
                if (!value.max_start_time) {
                    throw new Error("Пожалуйста, укажите максимальное время начала");
                }

                if (recordId) {
                    updateMutation.mutate({ data: value, id: recordId });
                } else {
                    createMutation.mutate(value);
                }
            } catch (error: any) {
                onError(error);
            }
        },
    });



    const [
        { data: organizationsData, isLoading: isOrganizationsLoading },
        { data: record, isLoading: isRecordLoading }
    ] = useQueries({
        queries: [

            {
                queryKey: ["organizations_cached"],
                queryFn: async () => {
                    const response = await apiClient.api.organization.cached.get({});
                    return response.data;
                },
            },
            {
                queryKey: ["one_schedule", recordId],
                queryFn: async () => {
                    if (recordId) {
                        return apiClient.api.work_schedule.get({
                            query: {
                                limit: "1",
                                offset: "0",
                                filters: JSON.stringify([{
                                    field: "id",
                                    operator: "=",
                                    value: recordId
                                }])
                            }
                        });
                    }
                    return null;
                },
                enabled: !!recordId,
            }
        ]
    });

    const isInitialLoading = isRecordLoading;

    const isLoading = useMemo(() => {
        return (
            createMutation.isPending ||
            updateMutation.isPending ||
            isOrganizationsLoading
        );
    }, [
        createMutation.isPending, updateMutation.isPending, isOrganizationsLoading]);

    const [changedOrganizationId, setChangedOrganizationId] = useState<string>("");


    const handleOrganizationChange = (value: string) => {
        setChangedOrganizationId(value);
        form.setFieldValue("organization_id", value);
    };

    const organizationLabelById = useMemo(() => {
        return organizationsData && Array.isArray(organizationsData)
            ? organizationsData.reduce((acc, item) => {
                acc[item.id] = item.name;
                return acc;
            }, {} as { [key: string]: string })
            : {};
    }, [organizationsData]);
    useEffect(() => {
        if (record?.data?.data?.[0]) {
            const schedule = record.data.data[0] as WorkSchedule;
            form.setFieldValue("name", schedule.name);
            form.setFieldValue("active", schedule.active);
            form.setFieldValue("organization_id", schedule.organization_id);
            setChangedOrganizationId(schedule.organization_id);
            form.setFieldValue("days", schedule.days);
            form.setFieldValue("start_time", schedule.start_time);
            form.setFieldValue("end_time", schedule.end_time);
            form.setFieldValue("max_start_time", schedule.max_start_time);
            form.setFieldValue("bonus_price", schedule.bonus_price);
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
                void form.handleSubmit();
            }}
            className="space-y-8"
        >
            <div className="grid gap-4">
                <div className="space-y-2">
                    <Label>Название графика</Label>
                    <form.Field name="name">
                        {(field) => (
                            <Input
                                placeholder="Название графика"
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(e.target.value)}
                            />
                        )}
                    </form.Field>
                </div>

                <div className="space-y-2">
                    <Label>Организация</Label>
                    <form.Field name="organization_id">
                        {(field) => (
                            <Select
                                value={field.state.value}
                                onValueChange={handleOrganizationChange}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Выберите бренд" />
                                </SelectTrigger>
                                <SelectContent>
                                    {(organizationsData || []).map((org) => (
                                        <SelectItem key={org.id} value={org.id}>
                                            {org.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </form.Field>
                </div>

                <div className="space-y-2">
                    <Label>Рабочие дни</Label>
                    <form.Field name="days">
                        {(field) => (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className="w-full justify-between"
                                    >
                                        {field.state.value.length > 0
                                            ? `Выбрано ${field.state.value.length} дней`
                                            : "Выберите рабочие дни"}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-full p-0">
                                    <Command>
                                        <CommandInput placeholder="Поиск дня..." />
                                        <CommandEmpty>Дни не найдены</CommandEmpty>
                                        <CommandGroup>
                                            {daysWeek.map((day) => {
                                                const isSelected = field.state.value.includes(day);
                                                return (
                                                    <CommandItem
                                                        key={day}
                                                        onSelect={() => {
                                                            const newValue = isSelected
                                                                ? field.state.value.filter((d) => d !== day)
                                                                : [...field.state.value, day];
                                                            field.handleChange(newValue);
                                                        }}
                                                    >
                                                        <div className={cn(
                                                            "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                                                            isSelected ? "bg-primary text-primary-foreground" : "opacity-50"
                                                        )}>
                                                            {isSelected && <Check className="h-4 w-4" />}
                                                        </div>
                                                        {day}
                                                    </CommandItem>
                                                );
                                            })}
                                        </CommandGroup>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        )}
                    </form.Field>
                    <div className="flex flex-wrap gap-1 mt-2">
                        <form.Field name="days">
                            {(field) => (
                                <>
                                    {field.state.value.map((day) => (
                                        <Badge key={day} variant="secondary" className="mr-1">
                                            {day}
                                        </Badge>
                                    ))}
                                </>
                            )}
                        </form.Field>
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <Label>Начало работы</Label>
                        <form.Field name="start_time">
                            {(field) => (
                                <Input
                                    type="time"
                                    value={field.state.value}
                                    onBlur={field.handleBlur}
                                    onChange={(e) => field.handleChange(e.target.value)}
                                />
                            )}
                        </form.Field>
                    </div>

                    <div className="space-y-2">
                        <Label>Конец работы</Label>
                        <form.Field name="end_time">
                            {(field) => (
                                <Input
                                    type="time"
                                    value={field.state.value}
                                    onBlur={field.handleBlur}
                                    onChange={(e) => field.handleChange(e.target.value)}
                                />
                            )}
                        </form.Field>
                    </div>

                    <div className="space-y-2">
                        <Label>Макс. время начала</Label>
                        <form.Field name="max_start_time">
                            {(field) => (
                                <Input
                                    type="time"
                                    value={field.state.value}
                                    onBlur={field.handleBlur}
                                    onChange={(e) => field.handleChange(e.target.value)}
                                />
                            )}
                        </form.Field>
                    </div>
                </div>

                <div className="space-y-2">
                    <Label>Бонус</Label>
                    <form.Field name="bonus_price">
                        {(field) => (
                            <Input
                                type="number"
                                placeholder="Сумма бонуса"
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(Number(e.target.value))}
                            />
                        )}
                    </form.Field>
                </div>

                <div className="space-y-2">
                    <Label>Статус</Label>
                    <form.Field name="active">
                        {(field) => (
                            <Select
                                value={field.state.value ? "active" : "inactive"}
                                onValueChange={(value) => field.handleChange(value === "active")}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Выберите статус" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="active">Активный</SelectItem>
                                    <SelectItem value="inactive">Неактивный</SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    </form.Field>
                </div>

                <Button type="submit" disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {recordId ? "Обновить" : "Создать"}
                </Button>
            </div>
        </form>
    )
}