import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { work_schedules } from "backend/drizzle/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { apiClient } from "@admin/utils/eden";
import { useForm } from "@tanstack/react-form";
import { Loader2, Check } from "lucide-react";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { Button } from "@admin/components/ui/button";
import { Badge } from "@components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@admin/components/ui/select";
import { cn } from "@admin/lib/utils";
import { useTranslations } from "next-intl";

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


// Значения дней хранятся в БД по-русски — не переводить сами значения, только подписи.
const daysWeek = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];

const dayKeys: Record<string, string> = {
    "Понедельник": "monday",
    "Вторник": "tuesday",
    "Среда": "wednesday",
    "Четверг": "thursday",
    "Пятница": "friday",
    "Суббота": "saturday",
    "Воскресенье": "sunday",
};

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
    const t = useTranslations("forms.schedule");
    const tc = useTranslations("forms.common");
    const formRef = useRef<HTMLFormElement | null>(null);
    const queryClient = useQueryClient();
    const onAddSuccess = (actionText: "added" | "updated") => {
        queryClient.invalidateQueries({ queryKey: ['work_schedules'] });
        queryClient.invalidateQueries({ queryKey: ['work_schedules_cached'] });
        toast.success(t(actionText));
        setOpen(false);
    };
    const [selectedDays, setSelectedDays] = useState<string[]>([]);

    const onError = (error: any) => {
        toast.error(error.message);
    };

    const createMutation = useMutation({
        mutationFn: (newTodo: typeof work_schedules.$inferInsert) => {
            if (!newTodo.organization_id) {
                throw new Error(t("errors.selectOrganization"));
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
        onSuccess: () => onAddSuccess("added"),
        onError,
    });

    const updateMutation = useMutation({
        mutationFn: (newTodo: {
            data: typeof work_schedules.$inferInsert;
            id: string;
        }) => {
            if (!newTodo.data.organization_id) {
                throw new Error(t("errors.selectOrganization"));
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

    // @ts-ignore
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
                    throw new Error(t("errors.selectOrganization"));
                }
                if (!value.name) {
                    throw new Error(t("errors.enterName"));
                }
                if (!value.days || value.days.length === 0) {
                    throw new Error(t("errors.selectDays"));
                }
                if (!value.start_time) {
                    throw new Error(t("errors.enterStartTime"));
                }
                if (!value.end_time) {
                    throw new Error(t("errors.enterEndTime"));
                }
                if (!value.max_start_time) {
                    throw new Error(t("errors.enterMaxStartTime"));
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

    const [formDataLoaded, setFormDataLoaded] = useState(false);
    const isInitialLoading = isRecordLoading && !formDataLoaded;

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
            console.log('Raw schedule data received:', schedule);

            // Установка всех значений формы из полученных данных
            const formValues = {
                name: schedule.name,
                active: schedule.active,
                organization_id: schedule.organization_id,
                days: Array.isArray(schedule.days) ? schedule.days : [],
                start_time: schedule.start_time,
                end_time: schedule.end_time,
                max_start_time: schedule.max_start_time,
                bonus_price: schedule.bonus_price,
            };

            // Обновляем состояние для организации
            setChangedOrganizationId(schedule.organization_id);

            // Обновляем состояние для дней недели
            setSelectedDays(Array.isArray(schedule.days) ? schedule.days : []);

            // Устанавливаем все значения в форму сразу после получения данных
            setTimeout(() => {
                Object.entries(formValues).forEach(([key, value]) => {
                    form.setFieldValue(key as keyof FormValues, value);
                });
                console.log('Form values set:', formValues);
            }, 0);
        }
    }, [record]);


    if (isInitialLoading) {
        return (
            <div className="flex items-center justify-center p-8">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    const handleDaysChange = (days: string[]) => {
        setSelectedDays(days);
        form.setFieldValue("days", days);
        console.log('Days changed:', days);
    };

    return (
        <form
            ref={formRef}
            onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void form.handleSubmit();
            }}
            className="space-y-8 p-4"
        >
            <div className="grid gap-4">
                <div className="space-y-2">
                    <Label>{t("name")}</Label>
                    <form.Field name="name">
                        {(field) => (
                            <Input
                                placeholder={t("name")}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(e.target.value)}
                            />
                        )}
                    </form.Field>
                </div>

                <div className="space-y-2">
                    <Label>{t("organization")}</Label>
                    <form.Field name="organization_id">
                        {(field) => (
                            <Select
                                value={field.state.value}
                                onValueChange={handleOrganizationChange}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder={t("selectBrand")} />
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
                    <Label>{t("workDays")}</Label>
                    <form.Field name="days">
                        {(field) => {
                            // Используем состояние selectedDays для отображения выбранных дней
                            const days = field.state.value;

                            return (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-7 gap-2">
                                        {daysWeek.map((day) => {
                                            const isSelected = days.includes(day);
                                            const shortDay = t(`daysShort.${dayKeys[day]}`);
                                            return (
                                                <div
                                                    key={day}
                                                    className={cn(
                                                        "flex flex-col items-center justify-center p-2 rounded-md border cursor-pointer transition-all duration-200 hover:border-primary",
                                                        isSelected ? "bg-primary text-primary-foreground border-primary" : "border-input"
                                                    )}
                                                    onClick={() => {
                                                        const newValue = isSelected
                                                            ? days.filter((d) => d !== day)
                                                            : [...days, day];

                                                        // Обновляем и состояние, и поле формы
                                                        field.handleChange(newValue);
                                                        handleDaysChange(newValue);
                                                    }}
                                                >
                                                    <span className="text-sm font-medium">{shortDay}</span>
                                                    {isSelected && <Check className="h-3 w-3 mt-1" />}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    <div className="flex flex-wrap gap-1">
                                        {days.length > 0 ? (
                                            days.map((day) => (
                                                <Badge key={day} variant="secondary" className="mr-1">
                                                    {dayKeys[day] ? t(`days.${dayKeys[day]}`) : day}
                                                    <span
                                                        className="ml-1 cursor-pointer hover:text-destructive"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            const newValue = days.filter((d) => d !== day);

                                                            // Обновляем и состояние, и поле формы
                                                            field.handleChange(newValue);
                                                            handleDaysChange(newValue);
                                                        }}
                                                    >
                                                        ×
                                                    </span>
                                                </Badge>
                                            ))
                                        ) : (
                                            <span className="text-sm text-muted-foreground">{t("selectWorkDays")}</span>
                                        )}
                                    </div>
                                </div>
                            );
                        }}
                    </form.Field>
                </div>

                <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                        <Label>{t("startTime")}</Label>
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
                        <Label>{t("endTime")}</Label>
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
                        <Label>{t("maxStartTime")}</Label>
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
                    <Label>{t("bonus")}</Label>
                    <form.Field name="bonus_price">
                        {(field) => (
                            <Input
                                type="number"
                                placeholder={t("bonusAmount")}
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(Number(e.target.value))}
                            />
                        )}
                    </form.Field>
                </div>

                <div className="space-y-2">
                    <Label>{tc("status")}</Label>
                    <form.Field name="active">
                        {(field) => (
                            <Select
                                value={field.state.value ? "active" : "inactive"}
                                onValueChange={(value) => field.handleChange(value === "active")}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder={t("selectStatus")} />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="active">{t("statusActive")}</SelectItem>
                                    <SelectItem value="inactive">{t("statusInactive")}</SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    </form.Field>
                </div>

                <Button type="submit" disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {recordId ? t("update") : tc("create")}
                </Button>
            </div>
        </form>
    )
}