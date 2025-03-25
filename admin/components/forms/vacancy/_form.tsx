import { toast } from "sonner";
import { Button } from "@admin/components/ui/buttonOrigin";
import { useMemo, useRef, useState, useEffect } from "react";
import { Loader2, CalendarIcon, Check } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { Label } from "@admin/components/ui/label";
import { Input } from "@admin/components/ui/input";
import { vacancy, work_schedules } from "@backend/../drizzle/schema";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQueries, useQueryClient, useQuery } from "@tanstack/react-query";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@admin/components/ui/select";
import { Textarea } from "@admin/components/ui/textarea";
import { Calendar } from "@admin/components/ui/calendar";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@admin/components/ui/popover";
import { cn } from "@admin/lib/utils";
import { useSession } from "next-auth/react";


type VacancyStatus = "open" | "in_progress" | "found_candidates" | "interview" | "closed" | "cancelled";

type WorkSchedule = {
    id: string;
    name: string;
    days: string[] | null;
    start_time: string;
    end_time: string;
    max_start_time: string;
    organization_id: string;
    active: boolean;
    bonus_price: number;
};

interface VacancyFormData {
    applicationNum: string;
    organizationId?: string;
    terminalId?: string;
    position: string;
    work_schedule_id?: string;
    reason: string;
    openDate: string;
    closingDate?: string;
    termClosingDate?: string;
    recruiter?: string;
    internship_date?: string;
    comments?: string;
    status: VacancyStatus;
}

type VacancyRecord = {
    id: string;
    applicationNum: string;
    organizationId: string;
    terminalId: string;
    position: string;
    workScheduleId?: string;
    reason: string;
    openDate: string;
    closingDate?: string;
    termClosingDate?: string;
    recruiter?: string;
    internshipDate?: string;
    comments?: string;
    status: VacancyStatus;
};

interface ApiWorkScheduleResponse {
    data: {
        total: number;
        data: WorkSchedule[];
    };
}

export default function VacancyForm({
    setOpen,
    recordId,
}: {
    setOpen: (open: boolean) => void;
    recordId?: string;
}) {
    const formRef = useRef<HTMLFormElement | null>(null);
    const queryClient = useQueryClient();

    const closeForm = () => {
        form.reset();
        setOpen(false);
    };

    const onAddSuccess = (actionText: string) => {
        toast.success(`Vacancy ${actionText}`);
        queryClient.invalidateQueries({ queryKey: ["vacancy"] });
        closeForm();
    };

    const onError = (error: any) => {
        toast.error(error.message);
    };

    type TreatyResponse<T> = {
        data: T;
        error: null;
        response: Response;
        status: number;
        headers: HeadersInit | undefined;
    };

    type CreateWorkScheduleData = typeof work_schedules.$inferInsert;

    interface WorkScheduleResponse {
        data: {
            data: typeof work_schedules.$inferSelect;
        }
    }

    interface ApiListResponse<T> {
        data: {
            data: T[];
            total: number;
        };
    }

    interface ApiWorkScheduleResponse {
        data: {
            total: number;
            data: WorkSchedule[];
        };
    }

    const createMutation = useMutation({
        mutationFn: async (newVacancy: VacancyFormData) => {
            try {
                if (!newVacancy.work_schedule_id) {
                    throw new Error("Please select work schedule");
                }
                const data = {
                    applicationNum: newVacancy.applicationNum,
                    organizationId: newVacancy.organizationId,
                    terminalId: newVacancy.terminalId,
                    position: newVacancy.position,
                    workScheduleId: newVacancy.work_schedule_id,
                    reason: newVacancy.reason,
                    openDate: new Date(newVacancy.openDate).toISOString(),
                    closingDate: newVacancy.closingDate ? new Date(newVacancy.closingDate).toISOString() : undefined,
                    termClosingDate: newVacancy.termClosingDate ? new Date(newVacancy.termClosingDate).toISOString() : undefined,
                    recruiter: newVacancy.recruiter,
                    internshipDate: newVacancy.internship_date ? new Date(newVacancy.internship_date).toISOString() : undefined,
                    comments: newVacancy.comments,
                    status: newVacancy.status || "open"
                };
                return await apiClient.api.vacancy.post({ data });
            } catch (error) {
                console.error('Error in createMutation:', error);
                throw error;
            }
        },
        onSuccess: () => onAddSuccess("Added"),
        onError,
    });

    const updateMutation = useMutation({
        mutationFn: async (newVacancy: {
            data: VacancyFormData;
            id: string;
        }) => {
            try {
                const data = {
                    applicationNum: newVacancy.data.applicationNum,
                    organizationId: newVacancy.data.organizationId,
                    terminalId: newVacancy.data.terminalId,
                    position: newVacancy.data.position,
                    workScheduleId: newVacancy.data.work_schedule_id,
                    reason: newVacancy.data.reason,
                    openDate: newVacancy.data.openDate,
                    closingDate: newVacancy.data.closingDate,
                    termClosingDate: newVacancy.data.termClosingDate,
                    recruiter: newVacancy.data.recruiter,
                    internshipDate: newVacancy.data.internship_date,
                    comments: newVacancy.data.comments,
                    status: newVacancy.data.status || "open"
                };
                return await apiClient.api.vacancy({ id: newVacancy.id }).put({ data });
            } catch (error) {
                console.error('Error in updateMutation:', error);
                throw error;
            }
        },
        onSuccess: () => onAddSuccess("Updated"),
        onError,
    });

    const [
        { data: record, isLoading: isRecordLoading },
        { data: terminalsData, isLoading: isTerminalsLoading },
        { data: organizationsData, isLoading: isOrganizationsLoading },
        { data: recruitersData, isLoading: isRecruitersLoading },
        { data: positionData, isLoading: isPositionsLoading },
        { data: workSchedulesData, isLoading: isWorkSchedulesLoading }
    ] = useQueries({
        queries: [
            {
                queryKey: ["one_vacancy", recordId],
                queryFn: async () => {
                    if (recordId) {
                        const response = await apiClient.api.vacancy.get({
                            query: {
                                limit: "1",
                                offset: "0",
                                filters: JSON.stringify([{
                                    field: "id",
                                    operator: "eq",
                                    value: recordId
                                }])
                            }
                        });
                        return response.data?.data?.[0] as VacancyRecord | null;
                    }
                    return null;
                },
                enabled: !!recordId,
            },
            {
                queryKey: ["terminals_cached"],
                queryFn: async () => {
                    const response = await apiClient.api.terminals.cached.get({});
                    return response.data;
                },
            },
            {
                queryKey: ["organizations_cached"],
                queryFn: async () => {
                    const response = await apiClient.api.organization.cached.get({});
                    return response.data;
                },
            },
            {
                queryKey: ["users_cached"],
                queryFn: async () => {
                    const response = await apiClient.api.users.cached.get({});
                    return response.data;
                },
            },
            {
                queryKey: ["positions_cached"],
                queryFn: async () => {
                    const response = await apiClient.api.positions.cached.get({})
                    return response.data;
                }
            },
            {
                queryKey: ["work_schedule_cached"],
                queryFn: async () => {
                    const response = await apiClient.api.work_schedule.cached.get({})
                    return response.data;
                }
            }
        ],
    });

    const form = useForm<VacancyFormData>({
        defaultValues: useMemo(() => {
            const status = record?.status;
            return {
                applicationNum: record?.applicationNum || "",
                organizationId: record?.organizationId || undefined,
                terminalId: record?.terminalId || undefined,
                position: record?.position || "",
                work_schedule_id: record?.workScheduleId || undefined,
                reason: record?.reason || "",
                openDate: record?.openDate || new Date().toISOString(),
                closingDate: record?.closingDate || undefined,
                termClosingDate: record?.termClosingDate || undefined,
                recruiter: record?.recruiter || undefined,
                internship_date: record?.internshipDate || undefined,
                comments: record?.comments || undefined,
                status: (status === "open" || status === "in_progress" || status === "found_candidates" ||
                    status === "interview" || status === "closed" || status === "cancelled") ? status : "open",
            };
        }, [record]),
        onSubmit: async ({ value }) => {
            if (!value.applicationNum) {
                toast.error("Номер вакансии обязателен");
                return;
            }

            if (!value.organizationId) {
                toast.error("Выберите бренд");
                return;
            }

            if (!value.position) {
                toast.error("Выберите должность");
                return;
            }

            const formData = {
                ...value,
                openDate: value.openDate || new Date().toISOString(),
                status: value.status || "open"
            };

            if (recordId) {
                updateMutation.mutate({ data: formData, id: recordId });
            } else {
                createMutation.mutate(formData);
            }
        },
    });

    const isLoading = useMemo(() => {
        return (
            createMutation.isPending ||
            updateMutation.isPending ||
            isRecordLoading ||
            isTerminalsLoading ||
            isOrganizationsLoading ||
            isRecruitersLoading ||
            isPositionsLoading ||
            isWorkSchedulesLoading
        );
    }, [
        createMutation.isPending,
        updateMutation.isPending,
        isRecordLoading,
        isTerminalsLoading,
        isOrganizationsLoading,
        isRecruitersLoading,
        isPositionsLoading,
        isWorkSchedulesLoading
    ]);

    const [changedOrganizationId, setChangedOrganizationId] = useState<string>("");
    const [changedTerminalId, setChangedTerminalId] = useState<string>("");
    const [changedPositionId, setChangedPositionId] = useState<string>("");
    const [changedRecruiterId, setChangedRecruiterId] = useState<string>("");
    const [changedWorkScheduleId, setChangedWorkScheduleId] = useState<string>("");

    const handleWorkScheduleChange = (value: string) => {
        try {
            setChangedWorkScheduleId(value);
            form.setFieldValue("work_schedule_id", value || undefined);
        } catch (error) {
            console.error('Error in handleWorkScheduleChange:', error);
        }
    };

    const handleOrganizationChange = (value: string) => {
        setChangedOrganizationId(value);
        form.setFieldValue("organizationId", value || "");
    };

    const handleTerminalChange = (value: string) => {
        setChangedTerminalId(value);
        form.setFieldValue("terminalId", value || "");
    };

    const handlePositionChange = (value: string) => {
        setChangedPositionId(value);
        form.setFieldValue("position", value || "");
    };

    const handleRecruiterChange = (value: string) => {
        setChangedRecruiterId(value);
        form.setFieldValue("recruiter", value || "");
    };

    const organizationLabelById = useMemo(() => {
        return organizationsData && Array.isArray(organizationsData)
            ? organizationsData.reduce((acc, item) => {
                acc[item.id] = item.name;
                return acc;
            }, {} as { [key: string]: string })
            : {};
    }, [organizationsData]);

    const terminalLabelById = useMemo(() => {
        return terminalsData && Array.isArray(terminalsData)
            ? terminalsData.reduce((acc, item) => {
                acc[item.id] = item.name;
                return acc;
            }, {} as { [key: string]: string })
            : {};
    }, [terminalsData]);

    const positionLabelById = useMemo(() => {
        return positionData && Array.isArray(positionData)
            ? positionData.reduce((acc, item) => {
                acc[item.id] = item.title;
                return acc;
            }, {} as { [key: string]: string })
            : {};
    }, [positionData]);

    const recruiterLabelById = useMemo(() => {
        return recruitersData && Array.isArray(recruitersData)
            ? recruitersData.reduce((acc, item) => {
                acc[item.id] = `${item.first_name} ${item.last_name}`;
                return acc;
            }, {} as { [key: string]: string })
            : {};
    }, [recruitersData]);

    const workSchedulesLabelById = useMemo(() => {
        return workSchedulesData && Array.isArray(workSchedulesData)
            ? workSchedulesData.reduce((acc, item) => {
                acc[item.id] = `${item.name}`;
                return acc;
            }, {} as { [key: string]: string })
            : {};

    }, [workSchedulesData])



    useEffect(() => {
        if (record) {
            Object.entries({
                applicationNum: record.applicationNum || "",
                organizationId: record.organizationId || undefined,
                terminalId: record.terminalId || undefined,
                position: record.position || "",
                work_schedule_id: record.workScheduleId || undefined,
                reason: record.reason || "",
                openDate: record.openDate || new Date().toISOString(),
                closingDate: record.closingDate || undefined,
                termClosingDate: record.termClosingDate || undefined,
                recruiter: record.recruiter || undefined,
                internship_date: record.internshipDate || undefined,
                comments: record.comments || undefined,
                status: record.status || "open",
            }).forEach(([key, value]) => {
                form.setFieldValue(key as keyof VacancyFormData, value);
            });

            if (record.organizationId) {
                setChangedOrganizationId(record.organizationId);
            }
            if (record.terminalId) {
                setChangedTerminalId(record.terminalId);
            }
            if (record.position) {
                setChangedPositionId(record.position);
            }
            if (record.recruiter) {
                setChangedRecruiterId(record.recruiter);
            }
            if (record.workScheduleId) {
                setChangedWorkScheduleId(record.workScheduleId);
            }
        }
    }, [record, form]);

    // const { data: workSchedulesResponse, isLoading: isWorkSchedulesLoading } = useQuery({
    //     queryKey: ["work_schedules", Array.from(changedOrganizationId)[0]],
    //     queryFn: async () => {
    //         const organizationId = Array.from(changedOrganizationId)[0] as string | undefined;
    //         if (!organizationId) return { data: { total: 0, data: [] as WorkSchedule[] } };

    //         const response = await apiClient.api.work_schedule.get({
    //             query: {
    //                 limit: "100",
    //                 offset: "0",
    //                 filters: JSON.stringify([{
    //                     field: "organization_id",
    //                     operator: "eq",
    //                     value: organizationId
    //                 }])
    //             }
    //         });

    //         const schedules: WorkSchedule[] = (response.data?.data || []).map((item: any) => ({
    //             id: item.id?.toString() || "",
    //             name: item.name || "",
    //             days: Array.isArray(item.days) ? item.days : [],
    //             start_time: item.start_time || "",
    //             end_time: item.end_time || "",
    //             max_start_time: item.max_start_time || "",
    //             organization_id: item.organization_id || "",
    //             active: Boolean(item.active),
    //             bonus_price: Number(item.bonus_price || 0)
    //         }));

    //         return {
    //             data: {
    //                 total: response.data?.total || 0,
    //                 data: schedules
    //             }
    //         };
    //     },
    //     enabled: typeof changedOrganizationId === 'object' && Array.from(changedOrganizationId).length > 0,
    // });

    // const workSchedules = workSchedulesResponse?.data?.data || [];

    const handleSubmit = async (e: React.FormEvent) => {
        try {
            e.preventDefault();
            e.stopPropagation();
            await form.handleSubmit();
        } catch (error) {
            console.error('Error in handleSubmit:', error);
        }
    };

    return (
        <form
            ref={formRef}
            onSubmit={handleSubmit}
            className="grid gap-4 p-4"
        >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Статус</Label>
                    <form.Field name="status">
                        {(field) => (
                            <Select
                                value={field.getValue()}
                                onValueChange={(value) => {
                                    field.setValue(value as VacancyStatus);
                                }}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Выберите статус" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="open">Открыта</SelectItem>
                                    <SelectItem value="in_progress">В процессе</SelectItem>
                                    <SelectItem value="found_candidates">Найдены кандидаты</SelectItem>
                                    <SelectItem value="interview">Собеседование</SelectItem>
                                    <SelectItem value="closed">Закрыта</SelectItem>
                                    <SelectItem value="cancelled">Отменена</SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    </form.Field>
                </div>
                
                <div className="space-y-2">
                    <Label>Номер вакансии</Label>
                    <form.Field name="applicationNum">
                        {(field) => (
                            <Input
                                id={field.name}
                                name={field.name}
                                value={field.getValue() ?? ""}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(e.target.value)}
                            />
                        )}
                    </form.Field>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Бренд</Label>
                    <form.Field name="organizationId">
                        {(field) => (
                            <Select
                                value={changedOrganizationId || ""}
                                onValueChange={(value) => {
                                    handleOrganizationChange(value);
                                }}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Выберите бренд">
                                        {changedOrganizationId ?
                                            organizationLabelById[changedOrganizationId] :
                                            "Выберите бренд"}
                                    </SelectValue>
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
                    <Label>Филиал</Label>
                    <form.Field name="terminalId">
                        {(field) => (
                            <Select
                                value={changedTerminalId || ""}
                                onValueChange={(value) => {
                                    handleTerminalChange(value);
                                }}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Выберите филиал">
                                        {changedTerminalId ?
                                            terminalLabelById[changedTerminalId] :
                                            "Выберите филиал"}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {(terminalsData || []).map((terminal) => (
                                        <SelectItem key={terminal.id} value={terminal.id}>
                                            {terminal.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </form.Field>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Должность</Label>
                    <form.Field name="position">
                        {(field) => (
                            <Select
                                value={changedPositionId || ""}
                                onValueChange={(value) => {
                                    handlePositionChange(value);
                                }}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Выберите должность">
                                        {changedPositionId ?
                                            positionLabelById[changedPositionId] :
                                            "Выберите должность"}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {(positionData || []).map((position) => (
                                        <SelectItem key={position.id} value={position.id}>
                                            {position.title}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </form.Field>
                </div>

                <div className="space-y-2">
                    <Label>График работы</Label>
                    <form.Field name="work_schedule_id">
                        {(field) => (
                            <Select
                                value={changedWorkScheduleId || ""}
                                onValueChange={(value) => {
                                    handleWorkScheduleChange(value);
                                }}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Выберите график работы">
                                        {changedWorkScheduleId ?
                                            workSchedulesLabelById[changedWorkScheduleId] :
                                            "Выберите график работы"}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {(workSchedulesData || []).map((schedule: WorkSchedule) => (
                                        <SelectItem key={schedule.id} value={schedule.id}>
                                            {schedule.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </form.Field>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Причина вакансии</Label>
                    <form.Field name="reason">
                        {(field) => (
                            <Input
                                id={field.name}
                                name={field.name}
                                value={field.getValue() ?? ""}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(e.target.value)}
                            />
                        )}
                    </form.Field>
                </div>

                <div className="space-y-2">
                    <Label>Рекрутер</Label>
                    <form.Field name="recruiter">
                        {(field) => (
                            <Select
                                value={changedRecruiterId || ""}
                                onValueChange={(value) => {
                                    handleRecruiterChange(value);
                                }}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Выберите рекрутера">
                                        {changedRecruiterId ?
                                            recruiterLabelById[changedRecruiterId] :
                                            "Выберите рекрутера"}
                                    </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                    {(recruitersData || []).map((user) => (
                                        <SelectItem key={user.id} value={user.id}>
                                            {`${user.first_name} ${user.last_name}`}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </form.Field>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                    <Label>Дата открытия</Label>
                    <form.Field name="openDate">
                        {(field) => (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-full pl-3 text-left font-normal",
                                            !field.getValue() && "text-muted-foreground"
                                        )}
                                    >
                                        {field.getValue() ? (
                                            format(new Date(field.getValue() || ''), "PPP")
                                        ) : (
                                            <span>Выберите дату</span>
                                        )}
                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={field.getValue() ? new Date(field.getValue() || '') : undefined}
                                        onSelect={(date) => {
                                            if (date) {
                                                const localDate = new Date(date.setHours(0, 0, 0, 0));
                                                field.handleChange(localDate.toISOString());
                                            }
                                        }}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        )}
                    </form.Field>
                </div>

                <div className="space-y-2">
                    <Label>Срок закрытия</Label>
                    <form.Field name="termClosingDate">
                        {(field) => (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-full pl-3 text-left font-normal",
                                            !field.getValue() && "text-muted-foreground"
                                        )}
                                    >
                                        {field.getValue() ? (
                                            format(new Date(field.getValue() || ''), "PPP")
                                        ) : (
                                            <span>Выберите дату</span>
                                        )}
                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={field.getValue() ? new Date(field.getValue() || '') : undefined}
                                        onSelect={(date) => {
                                            if (date) {
                                                const localDate = new Date(date.setHours(0, 0, 0, 0));
                                                field.handleChange(localDate.toISOString());
                                            }
                                        }}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        )}
                    </form.Field>
                </div>

                <div className="space-y-2">
                    <Label>Дата закрытия</Label>
                    <form.Field name="closingDate">
                        {(field) => (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-full pl-3 text-left font-normal",
                                            !field.getValue() && "text-muted-foreground"
                                        )}
                                    >
                                        {field.getValue() ? (
                                            format(new Date(field.getValue() || ''), "PPP")
                                        ) : (
                                            <span>Выберите дату</span>
                                        )}
                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={field.getValue() ? new Date(field.getValue() || '') : undefined}
                                        onSelect={(date) => {
                                            if (date) {
                                                const localDate = new Date(date.setHours(0, 0, 0, 0));
                                                field.handleChange(localDate.toISOString());
                                            }
                                        }}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        )}
                    </form.Field>
                </div>

                <div className="space-y-2">
                    <Label>Дата стажировки</Label>
                    <form.Field name="internship_date">
                        {(field) => (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-full pl-3 text-left font-normal",
                                            !field.getValue() && "text-muted-foreground"
                                        )}
                                    >
                                        {field.getValue() ? (
                                            format(new Date(field.getValue() || ''), "PPP")
                                        ) : (
                                            <span>Выберите дату</span>
                                        )}
                                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={field.getValue() ? new Date(field.getValue() || '') : undefined}
                                        onSelect={(date) => {
                                            if (date) {
                                                const localDate = new Date(date.setHours(0, 0, 0, 0));
                                                field.handleChange(localDate.toISOString());
                                            }
                                        }}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        )}
                    </form.Field>
                </div>
            </div>

            <div className="space-y-2">
                <Label>Комментарии</Label>
                <form.Field name="comments">
                    {(field) => (
                        <Textarea
                            id={field.name}
                            name={field.name}
                            value={field.getValue() ?? ""}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                        />
                    )}
                </form.Field>
            </div>

            <div className="mt-4">
                <Button type="submit" disabled={isLoading}>
                    {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {recordId ? "Обновить" : "Создать"}
                </Button>
            </div>
        </form>
    );
}
