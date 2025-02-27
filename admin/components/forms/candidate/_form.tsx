"use client";
import { useToast } from "@admin/components/ui/use-toast";
import { Button } from "@components/ui/button";
import { useMemo, useRef, useState, useEffect } from "react";
import { Loader2, CalendarIcon } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Select, SelectItem } from "@nextui-org/select";
import { Textarea } from "@components/ui/textarea";
import { Selection } from "@react-types/shared";
import { Chip } from "@nextui-org/chip";
import { Calendar } from "@admin/components/ui/calendar";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@components/ui/popover";
import { cn } from "@admin/lib/utils";
import EducationForm, { EducationEntry } from "../education/EducationForm";
// import { Calendar, DatePicker } from "@heroui/react";
interface ApiResponse<T = any> {
    data?: T[];
    error?: string;
    message?: string;
}

interface ApiCandidateData {
    vacancyId: string;
    fullName: string;
    birthDate: string;
    phoneNumber: string;
    email: string;
    citizenship: string;
    residence: string;
    passportNumber: string;
    passportSeries: string;
    passportIdDate: string;
    passportIdPlace: string;
    source: string;
    familyStatus: string;
    children: number;
    language: string;
    desiredSalary: string;
    desiredSchedule: string;
    purpose: string;
    strengthsShortage: string;
    relatives: string;
    desiredPosition: string;
    resultStatus: 'positive' | 'negative' | 'neutral';
    educations: EducationEntry[];
}

interface CandidateFormData {
    vacancyId: string;
    fullName: string;
    birthDate: string;
    phoneNumber: string;
    email: string;
    citizenship: string;
    residence: string;
    passportNumber: string;
    passportSeries: string;
    passportIdDate: string;
    passportIdPlace: string;
    source: string;
    familyStatus: string;
    children: number;
    language: string;
    desiredSalary?: string;
    desiredSchedule?: string;
    purpose?: string;
    strengthsShortage?: string;
    relatives?: string;
    desiredPosition?: string;
    resultStatus?: 'positive' | 'negative' | 'neutral';
    educations: EducationEntry[];
}

interface CandidateResponse {
    id: string;
    vacancyId: string;
    fullName: string;
    birthDate: string;
    phoneNumber: string;
    email?: string;
    citizenship?: string;
    residence?: string;
    passportNumber?: string;
    passportSeries?: string;
    passportIdDate?: string;
    passportIdPlace?: string;
    source?: string;
    familyStatus?: string;
    children?: number;
    language?: string;
    desiredSalary?: string;
    desiredSchedule?: string;
    purpose?: string;
    strengthsShortage?: string;
    relatives?: string;
    desiredPosition?: string;
    resultStatus?: 'positive' | 'negative' | 'neutral';
    education?: EducationEntry[];
    educations?: EducationEntry[];
}

export default function CandidateForm({
    setOpen,
    recordId,
}: {
    setOpen: (open: boolean) => void;
    recordId?: string;
}) {
    const formRef = useRef<HTMLFormElement | null>(null);
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [date, setDate] = useState<Date>();
    const [selectedVacancyId, setSelectedVacancyId] = useState<Selection>(new Set([]));
    const [selectedResultStatus, setSelectedResultStatus] = useState<Selection>(new Set([]));
    const [showEducationForm, setShowEducationForm] = useState(!recordId);
    const [educations, setEducations] = useState<EducationEntry[]>([]);
    const [passDate, setPassDate] = useState<Date>();

    // Add positions query
    const vacanciesQuery = useQuery({
        queryKey: ['vacancies'],
        queryFn: async () => {
            const response = await apiClient.api.vacancy.get({
                query: {
                    limit: '100'
                }
            });
            return response.data;
        }
    });

    // Add candidate query for edit mode
    const candidateQuery = useQuery({
        queryKey: ['candidate', recordId],
        queryFn: async (): Promise<ApiResponse> => {
            if (!recordId) throw new Error('No record ID provided');
            const response = await apiClient.api.candidates.get({
                query: {
                    filters: JSON.stringify([{
                        field: "id",
                        operator: "=",
                        value: recordId
                    }])
                }
            });
            const rawData = response.data?.data as Array<{
                id: string;
                vacancyId: string;
                fullName: string;
                birthDate: string;
                phoneNumber: string;
                [key: string]: any;
            }>;
            if (!rawData) {
                throw new Error('Invalid response from API');
            }
            return {
                data: rawData as CandidateResponse[]
            };
        },
        enabled: !!recordId
    });

    const closeForm = () => {
        form.reset();
        setOpen(false);
    };

    const onAddSuccess = (actionText: string) => {
        toast({
            title: "Успешно",
            description: `Кандидат ${actionText}`,
            duration: 5000,
        });
        queryClient.invalidateQueries({ queryKey: ["candidates"] });
        closeForm();
    };

    const onError = (error: any) => {
        toast({
            title: "Ошибка",
            description: error.message,
            variant: "destructive",
            duration: 5000,
        });
    };

    const createMutation = useMutation({
        mutationFn: async (newCandidate: CandidateFormData) => {
            try {
                console.log('Starting candidate creation with education data:', {
                    candidate: newCandidate,
                    educations: educations
                });

                // Validate and format dates
                if (!newCandidate.birthDate) {
                    throw new Error('Дата рождения обязательна');
                }

                if (!newCandidate.vacancyId) {
                    throw new Error('Вакансия обязательна');
                }

                if (!newCandidate.fullName) {
                    throw new Error('ФИО обязательно');
                }

                if (!newCandidate.phoneNumber) {
                    throw new Error('Номер телефона обязателен');
                }

                // Prepare data for API
                const formattedData: ApiCandidateData = {
                    ...newCandidate,
                    email: newCandidate.email || "",
                    citizenship: newCandidate.citizenship || "",
                    residence: newCandidate.residence || "",
                    passportNumber: newCandidate.passportNumber || "",
                    passportSeries: newCandidate.passportSeries || "",
                    passportIdDate: newCandidate.passportIdDate ? new Date(newCandidate.passportIdDate).toISOString() : "",
                    passportIdPlace: newCandidate.passportIdPlace || "",
                    source: newCandidate.source || "",
                    familyStatus: newCandidate.familyStatus || "",
                    children: newCandidate.children || 0,
                    language: newCandidate.language || "",
                    desiredSalary: newCandidate.desiredSalary || "",
                    desiredSchedule: newCandidate.desiredSchedule || "",
                    purpose: newCandidate.purpose || "",
                    strengthsShortage: newCandidate.strengthsShortage || "",
                    relatives: newCandidate.relatives || "",
                    desiredPosition: newCandidate.desiredPosition || "",
                    resultStatus: newCandidate.resultStatus as 'positive' | 'negative' | 'neutral' || 'neutral',
                    educations: educations
                };

                console.log('Sending formatted data to API:', formattedData);

                const response = await apiClient.api.candidates.post(formattedData);
                const responseData = (response as any)?.data;

                if (!responseData?.data?.id) {
                    throw new Error('Не удалось получить ID созданного кандидата');
                }

                console.log('Candidate created successfully:', responseData);

                return responseData;
            } catch (error: any) {
                console.error('Error in candidate creation:', {
                    message: error?.message || 'Unknown error',
                    stack: error?.stack || 'No stack trace',
                    originalData: newCandidate,
                    educations: educations
                });
                throw error;
            }
        },
        onSuccess: () => onAddSuccess("добавлен успешно"),
        onError: (error: any) => {
            console.error('Mutation error:', error);
            toast({
                title: "Ошибка",
                description: error.message || "Не удалось создать кандидата",
                variant: "destructive",
                duration: 5000,
            });
        },
    });

    const updateMutation = useMutation({
        mutationFn: async (params: {
            data: CandidateFormData;
            id: string
        }) => {
            try {
                // Получаем текущие данные из базы
                const currentData = candidateQuery.data?.data?.[0];
                if (!currentData) {
                    throw new Error("Current candidate data not found");
                }

                // Создаем объект только с измененными полями
                const changedFields = Object.entries(params.data).reduce((acc, [key, newValue]) => {
                    const currentValue = currentData[key as keyof typeof currentData];
                    // Сравниваем значения и добавляем только если они действительно изменились
                    if (JSON.stringify(newValue) !== JSON.stringify(currentValue)) {
                        // Для обязательных полей всегда используем значение
                        if (key === 'vacancyId' || key === 'fullName' || key === 'phoneNumber') {
                            acc[key as keyof CandidateFormData] = newValue;
                        }
                        // Для опциональных полей используем undefined вместо пустых значений
                        else if (newValue === '' || newValue === null) {
                            acc[key as keyof CandidateFormData] = undefined;
                        } else {
                            acc[key as keyof CandidateFormData] = newValue;
                        }
                    }
                    return acc;
                }, {} as Partial<CandidateFormData>);

                // Формируем объект для обновления с учетом типов API
                const updateData: {
                    vacancyId: string;
                    fullName: string;
                    phoneNumber: string;
                    birthDate: string;
                    email?: string;
                    citizenship?: string;
                    residence?: string;
                    passportNumber?: string;
                    passportSeries?: string;
                    passportIdDate?: string;
                    passportIdPlace?: string;
                    source?: string;
                    familyStatus?: string;
                    children?: number;
                    language?: string;
                    desiredSalary?: string;
                    desiredSchedule?: string;
                    purpose?: string;
                    strengthsShortage?: string;
                    relatives?: string;
                    desiredPosition?: string;
                    resultStatus?: 'positive' | 'negative' | 'neutral';

                } = {
                    // Обязательные поля
                    vacancyId: params.data.vacancyId,
                    fullName: params.data.fullName,
                    phoneNumber: params.data.phoneNumber,
                    birthDate: params.data.birthDate || currentData.birthDate || ''
                };

                // Добавляем опциональные поля только если они определены
                if (changedFields.email !== undefined) updateData.email = changedFields.email;
                if (changedFields.citizenship !== undefined) updateData.citizenship = changedFields.citizenship;
                if (changedFields.residence !== undefined) updateData.residence = changedFields.residence;
                if (changedFields.passportNumber !== undefined) updateData.passportNumber = changedFields.passportNumber;
                if (changedFields.passportSeries !== undefined) updateData.passportSeries = changedFields.passportSeries;
                if (changedFields.passportIdDate !== undefined) updateData.passportIdDate = changedFields.passportIdDate;
                if (changedFields.passportIdPlace !== undefined) updateData.passportIdPlace = changedFields.passportIdPlace;
                if (changedFields.source !== undefined) updateData.source = changedFields.source;
                if (changedFields.familyStatus !== undefined) updateData.familyStatus = changedFields.familyStatus;
                if (changedFields.children !== undefined) updateData.children = changedFields.children;
                if (changedFields.language !== undefined) updateData.language = changedFields.language;
                if (changedFields.desiredSalary !== undefined) updateData.desiredSalary = changedFields.desiredSalary;
                if (changedFields.desiredSchedule !== undefined) updateData.desiredSchedule = changedFields.desiredSchedule;
                if (changedFields.purpose !== undefined) updateData.purpose = changedFields.purpose;
                if (changedFields.strengthsShortage !== undefined) updateData.strengthsShortage = changedFields.strengthsShortage;
                if (changedFields.relatives !== undefined) updateData.relatives = changedFields.relatives;
                if (changedFields.desiredPosition !== undefined) updateData.desiredPosition = changedFields.desiredPosition;
                if (changedFields.resultStatus !== undefined) updateData.resultStatus = changedFields.resultStatus;

                return await apiClient.api.candidates({ id: params.id }).put(updateData);
            } catch (error) {
                console.error('Error in updateMutation:', error);
                throw error;
            }
        },
        onSuccess: () => onAddSuccess("обновлен успешно"),
        onError,
    });

    const form = useForm<CandidateFormData>({
        defaultValues: useMemo(() => {
            const candidate = candidateQuery.data?.data?.[0];
            return {
                vacancyId: candidate?.vacancyId || "",
                fullName: candidate?.fullName || "",
                birthDate: candidate?.birthDate || "",
                phoneNumber: candidate?.phoneNumber || "",
                email: candidate?.email || "",
                citizenship: candidate?.citizenship || "",
                residence: candidate?.residence || "",
                passportNumber: candidate?.passportNumber || "",
                passportSeries: candidate?.passportSeries || "",
                passportIdDate: candidate?.passportIdDate || "",
                passportIdPlace: candidate?.passportIdPlace || "",
                source: candidate?.source || "",
                familyStatus: candidate?.familyStatus || "",
                children: candidate?.children || 0,
                language: candidate?.language || "",
                desiredSalary: candidate?.desiredSalary || "",
                desiredSchedule: candidate?.desiredSchedule || "",
                purpose: candidate?.purpose || "",
                strengthsShortage: candidate?.strengthsShortage || "",
                relatives: candidate?.relatives || "",
                desiredPosition: candidate?.desiredPosition || "",
                resultStatus: candidate?.resultStatus || "neutral",
                educations: []
            };
        }, [candidateQuery.data]),
        onSubmit: async ({ value }) => {
            // Validate required fields
            if (!value.vacancyId) {
                toast({
                    title: "Ошибка",
                    description: "Пожалуйста, выберите вакансию",
                    variant: "destructive",
                });
                return;
            }

            if (!value.fullName) {
                toast({
                    title: "Ошибка",
                    description: "ФИО обязательно для заполнения",
                    variant: "destructive",
                });
                return;
            }

            if (!value.phoneNumber) {
                toast({
                    title: "Ошибка",
                    description: "Номер телефона обязателен для заполнения",
                    variant: "destructive",
                });
                return;
            }

            try {
                // Check if we have any education entries
                console.log('Current educations state before submission:', educations);

                // Проверяем, есть ли записи об образовании
                if (educations.length === 0) {
                    // Спрашиваем пользователя, хочет ли он продолжить без образования
                    if (!window.confirm("У кандидата не добавлено образование. Продолжить без данных об образовании?")) {
                        // Если пользователь отказался, показываем форму образования
                        setShowEducationForm(true);
                        return;
                    }
                }

                // Include educations in the submission data
                const submissionData = {
                    ...value,
                    educations: educations
                };

                console.log('Submitting candidate data with educations:', submissionData);

                if (recordId) {
                    await updateMutation.mutateAsync({
                        data: submissionData,
                        id: recordId
                    });
                } else {
                    await createMutation.mutateAsync(submissionData);
                }
            } catch (error) {
                console.error('Form submission error:', error);
            }
        }
    });

    const handleVacancyChange = (selection: Selection) => {
        setSelectedVacancyId(selection);
        const selectedVacancy = Array.from(selection)[0] as string | undefined;
        form.setFieldValue("vacancyId", selectedVacancy || "");
    };

    const handleResultStatusChange = (selection: Selection) => {
        setSelectedResultStatus(selection);
        const selectedStatus = Array.from(selection)[0] as 'positive' | 'negative' | 'neutral' | undefined;
        form.setFieldValue("resultStatus", selectedStatus || "neutral");
    };

    const handleAddEducation = (education: EducationEntry) => {
        console.log('handleAddEducation called with:', education);
        // Prevent any form submission
        try {
            // Создаем новый массив, чтобы убедиться что состояние обновляется
            const updatedEducations = [...educations, education];
            console.log('Updated educations array:', updatedEducations);
            setEducations(updatedEducations);

            // Показываем уведомление об успешном добавлении
            toast({
                title: "Образование добавлено",
                description: `${education.university} - ${education.speciality}`,
                duration: 3000,
            });
        } catch (error) {
            console.error('Error in handleAddEducation:', error);
        }
    };

    const handleRemoveEducation = (index: number) => {
        setEducations(educations.filter((_, i) => i !== index));
    };

    useEffect(() => {
        const candidate = candidateQuery.data?.data?.[0];
        if (candidate) {
            // Set initial form values
            Object.entries({
                vacancyId: candidate.vacancyId || "",
                fullName: candidate.fullName || "",
                birthDate: candidate.birthDate || "",
                phoneNumber: candidate.phoneNumber || "",
                email: candidate.email || "",
                citizenship: candidate.citizenship || "",
                residence: candidate.residence || "",
                passportNumber: candidate.passportNumber || "",
                passportSeries: candidate.passportSeries || "",
                passportIdDate: candidate.passportIdDate || "",
                passportIdPlace: candidate.passportIdPlace || "",
                source: candidate.source || "",
                familyStatus: candidate.familyStatus || "",
                children: candidate.children || 0,
                language: candidate.language || "",
                desiredSalary: candidate.desiredSalary || "",
                desiredSchedule: candidate.desiredSchedule || "",
                purpose: candidate.purpose || "",
                strengthsShortage: candidate.strengthsShortage || "",
                relatives: candidate.relatives || "",
                desiredPosition: candidate.desiredPosition || "",
                resultStatus: candidate.resultStatus || "neutral",
            }).forEach(([key, value]) => {
                form.setFieldValue(key as keyof CandidateFormData, value);
            });

            // Set selected values for dropdowns
            if (candidate.vacancyId) {
                setSelectedVacancyId(new Set([candidate.vacancyId]));
            }
            if (candidate.resultStatus) {
                setSelectedResultStatus(new Set([candidate.resultStatus]));
            }
            if (candidate.birthDate) {
                setDate(new Date(candidate.birthDate));
            }

            // Set education data if available
            if (candidate.education && Array.isArray(candidate.education) && candidate.education.length > 0) {
                console.log('Setting education data from candidate.education:', candidate.education);
                setEducations(candidate.education);
            } else if (candidate.educations && Array.isArray(candidate.educations) && candidate.educations.length > 0) {
                console.log('Setting education data from candidate.educations:', candidate.educations);
                setEducations(candidate.educations);
            }
        }
    }, [candidateQuery.data, form]);

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
            className="space-y-4"
        >
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Вакансия *</Label>
                    <form.Field name="vacancyId">
                        {(field) => (
                            <Select
                                id={field.name}
                                name={field.name}
                                value={field.getValue() ?? ""}
                                selectedKeys={selectedVacancyId}
                                onSelectionChange={handleVacancyChange}
                                isLoading={vacanciesQuery.isLoading}
                                placeholder="Выберите вакансию"
                                isRequired
                                popoverProps={{
                                    portalContainer: formRef.current!,
                                    offset: 0,
                                    containerPadding: 0,
                                }}
                                renderValue={(items) => (
                                    <div className="flex flex-wrap gap-2">
                                        {Array.from(selectedVacancyId).map((item) => {
                                            const vacancy = vacanciesQuery.data?.data?.find(v => v.id === item);
                                            return (
                                                <Chip key={item}>
                                                    {vacancy ? `${vacancy.applicationNum} - ${vacancy.position}` : item}
                                                </Chip>
                                            );
                                        })}
                                    </div>
                                )}
                            >
                                {vacanciesQuery.data?.data ? vacanciesQuery.data.data.map((vacancy: any) => (
                                    <SelectItem key={vacancy.id} value={vacancy.id}>
                                        {vacancy.applicationNum} - {vacancy.position}
                                    </SelectItem>
                                )) : []}
                            </Select>
                        )}
                    </form.Field>
                </div>
                <div className="space-y-2">
                    <Label>ФИО *</Label>
                    <form.Field name="fullName">
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

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Дата рождения</Label>
                    <form.Field name="birthDate">
                        {(field) => (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-full justify-start text-left font-normal",
                                            !date && "text-muted-foreground"
                                        )}
                                        aria-label="Select date"
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {date ? format(date, "PPP") : <span>Выберите дату</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar
                                        mode="single"
                                        selected={date}
                                        onSelect={(date) => {
                                            setDate(date);
                                            if (date) {
                                                field.handleChange(format(date, "yyyy-MM-dd"));
                                            }
                                        }}
                                        className="rounded-md border shadow"
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        )}
                    </form.Field>
                </div>
                <div className="space-y-2">
                    <Label>Номер телефона *</Label>
                    <form.Field name="phoneNumber">
                        {(field) => (
                            <Input
                                id={field.name}
                                name={field.name}
                                value={field.getValue() ?? ""}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(e.target.value)}
                                type="tel"
                            />
                        )}
                    </form.Field>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Электронная почта</Label>
                    <form.Field name="email">
                        {(field) => (
                            <Input
                                id={field.name}
                                name={field.name}
                                value={field.getValue() ?? ""}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(e.target.value)}
                                type="email"
                            />
                        )}
                    </form.Field>
                </div>
                <div className="space-y-2">
                    <Label>Гражданство</Label>
                    <form.Field name="citizenship">
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

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Место жительства</Label>
                    <form.Field name="residence">
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
                    <Label>Семейное положение</Label>
                    <form.Field name="familyStatus">
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

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Дети</Label>
                    <form.Field name="children">
                        {(field) => (
                            <Input
                                type="number"
                                id={field.name}
                                name={field.name}
                                value={field.getValue() ?? ""}
                                onBlur={field.handleBlur}
                                onChange={(e) => {
                                    field.handleChange(Number(e.target.value));
                                }}
                            />
                        )}
                    </form.Field>
                </div>
                <div className="space-y-2">
                    <Label>Язык</Label>
                    <form.Field name="language">
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

            <div className="space-y-2">
                <Label>Источник</Label>
                <form.Field name="source">
                    {(field) => (
                        <Input
                            id={field.name}
                            name={field.name}
                            value={field.getValue() ?? ""}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                            placeholder="Где вы о нас узнали?"
                        />
                    )}
                </form.Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Номер паспорта</Label>
                    <form.Field name="passportNumber">
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
                    <Label>Серия паспорта</Label>
                    <form.Field name="passportSeries">
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

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Дата выдачи паспорта</Label>
                    <form.Field name="passportIdDate">
                        {(field) => (
                            // <DatePicker
                            //     showMonthAndYearPickers
                            //     className="max-w-md"
                            //     value={date}
                            //     variant="bordered"
                            //     onChange={setDate}
                            //     popoverProps={{
                            //         portalContainer: formRef.current!,
                            //         offset: 0,
                            //         containerPadding: 0,
                            //     }}
                            // />
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant={"outline"}
                                        className={cn(
                                            "w-full justify-start text-left font-normal",
                                            !passDate && "text-muted-foreground"
                                        )}
                                        aria-label="Select date"
                                    >
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {passDate ? format(passDate, "PPP") : <span>Выберите дату</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar
                                        mode="single"
                                        selected={passDate}
                                        onSelect={(date) => {
                                            setPassDate(date);
                                            if (date) {
                                                field.handleChange(format(date, "yyyy-MM-dd"));
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
                    <Label>Место выдачи паспорта</Label>
                    <form.Field name="passportIdPlace">
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

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Желаемая зарплата</Label>
                    <form.Field name="desiredSalary">
                        {(field) => (
                            <Input
                                id={field.name}
                                name={field.name}
                                value={field.getValue() ?? ""}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(e.target.value)}
                                type="number"
                            />
                        )}
                    </form.Field>
                </div>
                <div className="space-y-2">
                    <Label>Желаемый график</Label>
                    <form.Field name="desiredSchedule">
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

            <div className="space-y-2">
                <Label>Цель</Label>
                <form.Field name="purpose">
                    {(field) => (
                        <Textarea
                            id={field.name}
                            name={field.name}
                            value={field.getValue() ?? ""}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                            placeholder="Цель присоединения к нашей компании"
                        />
                    )}
                </form.Field>
            </div>

            <div className="space-y-2">
                <Label>Сильные и слабые стороны</Label>
                <form.Field name="strengthsShortage">
                    {(field) => (
                        <Textarea
                            id={field.name}
                            name={field.name}
                            value={field.getValue() ?? ""}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                            placeholder="Ваши сильные стороны и области для улучшения"
                        />
                    )}
                </form.Field>
            </div>

            <div className="space-y-2">
                <Label>Родственники</Label>
                <form.Field name="relatives">
                    {(field) => (
                        <Textarea
                            id={field.name}
                            name={field.name}
                            value={field.getValue() ?? ""}
                            onBlur={field.handleBlur}
                            onChange={(e) => field.handleChange(e.target.value)}
                            placeholder="Информация о родственниках"
                        />
                    )}
                </form.Field>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Желаемая должность</Label>
                    <form.Field name="desiredPosition">
                        {(field) => (
                            <Input
                                id={field.name}
                                name={field.name}
                                value={field.getValue() ?? ""}
                                onBlur={field.handleBlur}
                                onChange={(e) => field.handleChange(e.target.value)}
                                placeholder="Какую должность вы ищете?"
                            />
                        )}
                    </form.Field>
                </div>
                <div className="space-y-2">
                    <Label>Статус результата</Label>
                    <form.Field name="resultStatus">
                        {(field) => (
                            <Select
                                id={field.name}
                                name={field.name}
                                value={field.getValue() ?? "neutral"}
                                selectedKeys={selectedResultStatus}
                                onSelectionChange={handleResultStatusChange}
                                placeholder="Выберите статус результата"
                                popoverProps={{
                                    portalContainer: formRef.current!,
                                    offset: 0,
                                    containerPadding: 0,
                                }}
                                renderValue={(items) => (
                                    <div className="flex flex-wrap gap-2">
                                        {Array.from(selectedResultStatus).map((item) => (
                                            <Chip key={item}>
                                                {item === 'positive' ? 'Положительный' :
                                                    item === 'negative' ? 'Отрицательный' : 'Нейтральный'}
                                            </Chip>
                                        ))}
                                    </div>
                                )}
                            >
                                <SelectItem key="positive" value="positive">Положительный</SelectItem>
                                <SelectItem key="negative" value="negative">Отрицательный</SelectItem>
                                <SelectItem key="neutral" value="neutral">Нейтральный</SelectItem>
                            </Select>
                        )}
                    </form.Field>
                </div>
            </div>

            <div className="space-y-4">
                <div className="flex justify-between items-center border-t pt-4 mt-4">
                    <Label className="text-lg font-bold">Образование</Label>
                    <Button
                        type="button"
                        variant={showEducationForm ? "outline" : "default"}
                        size="sm"
                        onClick={() => setShowEducationForm(!showEducationForm)}
                        className="flex items-center gap-2"
                    >
                        {showEducationForm ? "Скрыть форму" : `Добавить образование ${educations.length > 0 ? `(${educations.length})` : ''}`}
                    </Button>
                </div>

                {showEducationForm && (
                    <div className="mt-2 p-4 border rounded-md">
                        <div onClick={(e) => e.stopPropagation()}>
                            <EducationForm
                                entries={educations}
                                onAdd={handleAddEducation}
                                onRemove={handleRemoveEducation}
                            />
                        </div>
                    </div>
                )}

                {/* Отображаем список добавленных записей даже если форма скрыта */}
                {educations.length > 0 && !showEducationForm && (
                    <div className="mt-2 p-4 border rounded-md">
                        <p className="font-medium mb-2">Добавленные записи об образовании: {educations.length}</p>
                        <ul className="list-disc pl-5">
                            {educations.map((edu, index) => (
                                <li key={index} className="mb-1">
                                    {edu.university} - {edu.speciality} ({edu.educationType})
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleRemoveEducation(index)}
                                        className="ml-2 h-6 text-red-500 hover:text-red-700"
                                    >
                                        Удалить
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </div>

            <div className="flex justify-end space-x-4">
                <Button
                    type="button"
                    variant="outline"
                    onClick={closeForm}
                    aria-label="Отменить форму"
                >
                    Отмена
                </Button>
                <Button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                    aria-label={recordId ? "Обновить кандидата" : "Отправить нового кандидата"}
                >
                    {(createMutation.isPending || updateMutation.isPending) && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {recordId ? "Обновить" : "Отправить"}
                </Button>
            </div>
        </form>
    );
} 