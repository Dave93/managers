import { useToast } from "@admin/components/ui/use-toast";
import { Button } from "@components/ui/button";
import { useMemo, useRef, useState, useEffect } from "react";
import { Loader2, CalendarIcon } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { vacancy, work_schedules } from "@backend/../drizzle/schema";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQueries, useQueryClient, useQuery } from "@tanstack/react-query";
import { Select, SelectItem } from "@nextui-org/select";
import { Textarea } from "@components/ui/textarea";
import { Selection } from "@react-types/shared";
import { Chip } from "@nextui-org/chip";
import { Calendar } from "@admin/components/ui/calendar";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@components/ui/popover";
import { cn } from "@admin/lib/utils";

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
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const closeForm = () => {
        form.reset();
        setOpen(false);
    };

    const onAddSuccess = (actionText: string) => {
        toast({
            title: "Success",
            description: `Vacancy ${actionText}`,
            duration: 5000,
        });
        queryClient.invalidateQueries({ queryKey: ["vacancy"] });
        closeForm();
    };

    const onError = (error: any) => {
        toast({
            title: "Error",
            description: error.message,
            variant: "destructive",
            duration: 5000,
        });
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
                    openDate: newVacancy.openDate,
                    closingDate: newVacancy.closingDate,
                    recruiter: newVacancy.recruiter,
                    internshipDate: newVacancy.internship_date,
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
                                filters: JSON.stringify([{
                                    field: "id",
                                    operator: "=",
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
                recruiter: record?.recruiter || undefined,
                internshipDate: record?.internshipDate || undefined,
                comments: record?.comments || undefined,
                status: (status === "open" || status === "in_progress" || status === "found_candidates" ||
                    status === "interview" || status === "closed" || status === "cancelled") ? status : "open",
            };
        }, [record]),
        onSubmit: async ({ value }) => {
            if (!value.applicationNum) {
                toast({
                    title: "Error",
                    description: "Номер вакансии обязателен",
                    variant: "destructive",
                    duration: 5000,
                });
                return;
            }

            if (!value.organizationId) {
                toast({
                    title: "Error",
                    description: "Выберите бренд",
                    variant: "destructive",
                    duration: 5000,
                });
                return;
            }

            if (!value.position) {
                toast({
                    title: "Error",
                    description: "Выберите должность",
                    variant: "destructive",
                    duration: 5000,
                });
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

    const [changedOrganizationId, setChangedOrganizationId] = useState<Selection>(new Set([]));
    const [changedTerminalId, setChangedTerminalId] = useState<Selection>(new Set([]));
    const [changedPositionId, setChangedPositionId] = useState<Selection>(new Set([]));
    const [changedRecruiterId, setChangedRecruiterId] = useState<Selection>(new Set([]));
    const [changedWorkScheduleId, setChangedWorkScheduleId] = useState<Selection>(new Set([]));

    const handleWorkScheduleChange = (selection: Selection) => {
        try {
            setChangedWorkScheduleId(selection);
            const selectedSchedule = Array.from(selection)[0] as string | undefined;
            form.setFieldValue("work_schedule_id", selectedSchedule || undefined);
        } catch (error) {
            console.error('Error in handleWorkScheduleChange:', error);
        }
    };

    const handleOrganizationChange = (selection: Selection) => {
        setChangedOrganizationId(selection);
        const selectedOrg = Array.from(selection)[0] as string | undefined;
        form.setFieldValue("organizationId", selectedOrg || "");
    };

    const handleTerminalChange = (selection: Selection) => {
        setChangedTerminalId(selection);
        const selectedTerminal = Array.from(selection)[0] as string | undefined;
        form.setFieldValue("terminalId", selectedTerminal || "");
    };

    const handlePositionChange = (selection: Selection) => {
        setChangedPositionId(selection);
        const selectedPosition = Array.from(selection)[0] as string | undefined;
        form.setFieldValue("position", selectedPosition || "");
    };

    const handleRecruiterChange = (selection: Selection) => {
        setChangedRecruiterId(selection);
        const selectedRecruiter = Array.from(selection)[0] as string | undefined;
        form.setFieldValue("recruiter", selectedRecruiter || "");
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
                recruiter: record.recruiter || undefined,
                internshipDate: record.internshipDate || undefined,
                comments: record.comments || undefined,
                status: record.status || "open",
            }).forEach(([key, value]) => {
                form.setFieldValue(key as keyof VacancyFormData, value);
            });

            if (record.organizationId) {
                setChangedOrganizationId(new Set([record.organizationId]));
            }
            if (record.terminalId) {
                setChangedTerminalId(new Set([record.terminalId]));
            }
            if (record.position) {
                setChangedPositionId(new Set([record.position]));
            }
            if (record.recruiter) {
                setChangedRecruiterId(new Set([record.recruiter]));
            }
            if (record.workScheduleId) {
                setChangedWorkScheduleId(new Set([record.workScheduleId]))
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
            className="grid gap-3 grid-cols-2 space-y-3 space-x-2"
        >
            <div className="space-y-2">
                <div>
                    <Label>Статус</Label>
                </div>
                <form.Field name="status">
                    {(field) => (
                        <Select
                            label="Статус"
                            placeholder="Выберите статус"
                            selectedKeys={[field.getValue()]}
                            className="max-w-xs"
                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                                field.setValue(e.target.value as "open" | "in_progress" | "found_candidates" | "interview" | "closed" | "cancelled");
                            }}
                            popoverProps={{
                                portalContainer: formRef.current!,
                                offset: 0,
                                containerPadding: 0,
                            }}
                            renderValue={(items) => (
                                <div>
                                    {[field.getValue()].map((item) => (
                                        <Chip key={item}>
                                            {[
                                                { value: "open", label: "Открыта" },
                                                { value: "in_progress", label: "В процессе" },
                                                { value: "found_candidates", label: "Найдены кандидаты" },
                                                { value: "interview", label: "Собеседование" },
                                                { value: "closed", label: "Закрыта" },
                                                { value: "cancelled", label: "Отменена" }
                                            ].find(status => status.value === item)?.label}
                                        </Chip>
                                    ))}
                                </div>
                            )}
                        >
                            {[
                                { value: "open", label: "Открыта" },
                                { value: "in_progress", label: "В процессе" },
                                { value: "found_candidates", label: "Найдены кандидаты" },
                                { value: "interview", label: "Собеседование" },
                                { value: "closed", label: "Закрыта" },
                                { value: "cancelled", label: "Отменена" }
                            ].map((status) => (
                                <SelectItem key={status.value} value={status.value}>
                                    {status.label}
                                </SelectItem>
                            ))}
                        </Select>
                    )}
                </form.Field>
            </div>
            <div className="col-span-2">
                <div>
                    <Label>Номер вакансии</Label>
                </div>
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

            <div className="space-y-2">
                <div>
                    <Label>Бренд</Label>
                </div>
                <form.Field name="organizationId">
                    {(field) => (
                        <Select
                            name="organizationId"
                            label="Бренд"
                            selectionMode="single"
                            placeholder="Выберите бренд"
                            selectedKeys={changedOrganizationId}
                            className="max-w-xs"
                            onSelectionChange={handleOrganizationChange}
                            popoverProps={{
                                portalContainer: formRef.current!,
                                offset: 0,
                                containerPadding: 0,
                            }}
                            renderValue={(items) => (
                                <div className="flex flex-wrap gap-2">
                                    {Array.from(changedOrganizationId).map((item) => (
                                        <Chip key={item}>{organizationLabelById[item]}</Chip>
                                    ))}
                                </div>
                            )}
                        >
                            {(organizationsData || []).map((org) => (
                                <SelectItem key={org.id} value={org.id}>
                                    {org.name}
                                </SelectItem>
                            ))}
                        </Select>
                    )}
                </form.Field>
            </div>

            <div className="space-y-2">
                <div>
                    <Label>Филиал</Label>
                </div>
                <form.Field name="terminalId">
                    {(field) => (
                        <Select
                            label="Филиал"
                            placeholder="Выберите филиал"
                            selectedKeys={changedTerminalId}
                            className="max-w-xs"
                            onSelectionChange={handleTerminalChange}
                            popoverProps={{
                                portalContainer: formRef.current!,
                                offset: 0,
                                containerPadding: 0,
                            }}
                            renderValue={(items) => (
                                <div>
                                    {Array.from(changedTerminalId).map((item) => (
                                        <Chip key={item}>{terminalLabelById[item]}</Chip>
                                    ))}
                                </div>
                            )}
                        >

                            {(terminalsData || []).map((terminal) => (
                                <SelectItem key={terminal.id} value={terminal.id}>
                                    {terminal.name}
                                </SelectItem>
                            ))}
                        </Select>
                    )}
                </form.Field>
            </div>

            <div className="space-y-2">
                <div>
                    <Label>Должность</Label>
                </div>
                <form.Field name="position">
                    {(field) => (
                        <Select
                            label="Должность"
                            placeholder="Выберите Должность"
                            selectedKeys={changedPositionId}
                            className="max-w-xs"
                            onSelectionChange={handlePositionChange}
                            popoverProps={{
                                portalContainer: formRef.current!,
                                offset: 0,
                                containerPadding: 0,
                            }}
                            renderValue={(items) => (
                                <div>
                                    {Array.from(changedPositionId).map((item) => (
                                        <Chip key={item}>{positionLabelById[item]}</Chip>
                                    ))}
                                </div>
                            )}
                        >
                            {(positionData || []).map((position) => (
                                <SelectItem key={position.id} value={position.id}>
                                    {position.title}
                                </SelectItem>
                            ))}
                        </Select>
                    )}
                </form.Field>
            </div>

            <div className="space-y-2">
                <div>
                    <Label>График работы</Label>
                </div>
                <form.Field name="work_schedule_id">
                    {(field) => (
                        <Select
                            name="work_schedule_id"
                            label="График работы"
                            selectionMode="single"
                            placeholder="Выберите график работы"
                            selectedKeys={changedWorkScheduleId}
                            className="max-w-xs"
                            onSelectionChange={handleWorkScheduleChange}
                            popoverProps={{
                                portalContainer: formRef.current!,
                                offset: 0,
                                containerPadding: 0,
                            }}

                        >
                            {(workSchedulesData || []).map((schedule: WorkSchedule) => (
                                <SelectItem key={schedule.id} value={schedule.id}>
                                    {schedule.name}
                                </SelectItem>
                            ))}
                        </Select>
                    )}
                </form.Field>
            </div>

            <div className="space-y-2">
                <div>
                    <Label>Причина вакансии</Label>
                </div>
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

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                    <div>
                        <Label>Дата открытия</Label>
                    </div>
                    <form.Field name="openDate">
                        {(field) => (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-[150px] pl-3 text-left font-normal",
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
                                                field.handleChange(date.toISOString());
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
                    <div>
                        <Label>Дата закрытия</Label>
                    </div>
                    <form.Field name="closingDate">
                        {(field) => (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-[150px] pl-3 text-left font-normal",
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
                                                field.handleChange(date.toISOString());
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
                    <div>
                        <Label>Дата стажировки</Label>
                    </div>
                    <form.Field name="internship_date">
                        {(field) => (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-[150px] pl-3 text-left font-normal",
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
                                                field.handleChange(date.toISOString());
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
                <div>
                    <Label>Рекрутер</Label>
                </div>
                <form.Field name="recruiter">
                    {(field) => (
                        <Select
                            label="Рекрутер"
                            placeholder="Выберите рекрутера"
                            selectedKeys={changedRecruiterId}
                            className="max-w-xs"
                            onSelectionChange={handleRecruiterChange}
                            popoverProps={{
                                portalContainer: formRef.current!,
                                offset: 0,
                                containerPadding: 0,
                            }}
                            renderValue={(items) => (
                                <div>
                                    {Array.from(changedRecruiterId).map((item) => (
                                        <Chip key={item}>{recruiterLabelById[item]}</Chip>
                                    ))}
                                </div>
                            )}

                        >
                            {(recruitersData || []).map((user) => (
                                <SelectItem key={user.id} value={user.id}>
                                    {`${user.first_name} ${user.last_name}`}
                                </SelectItem>
                            ))}
                        </Select>
                    )}
                </form.Field>
            </div>

            <div className="col-span-2">
                <div>
                    <Label>Комментарии</Label>
                </div>
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

            <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {recordId ? "Обновить" : "Создать"}
            </Button>
        </form >
    );
}
