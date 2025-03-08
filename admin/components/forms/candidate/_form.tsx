"use client";
import { useToast } from "@admin/components/ui/use-toast";
import { Button } from "@admin/components/ui/button";
import { useMemo, useRef, useState, useEffect } from "react";
import { Loader2, CalendarIcon } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { Textarea } from "@components/ui/textarea";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@components/ui/popover";
import { cn } from "@admin/lib/utils";
import EducationForm, { EducationEntry } from "../education/EducationForm";
import LastWorkPlaceForm, { LastWorkPlaceEntry } from "../last_work_place/LastWorkPlaceForm";
import FamilyListForm, { FamilyListEntry } from "../family_list/FamilyListForm";
import { parseZonedDateTime } from "@internationalized/date";
import React from "react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@components/ui/select";
import { CalendarOrigin } from "@admin/components/ui/calendarOrigin";
import { Calendar } from "@admin/components/ui/calendar";


interface DropdownNavProps {
    children: React.ReactNode;
}

interface DropdownProps {
    value: number;
    onChange?: (value: number) => void;
    options?: { value: number; label: string; disabled?: boolean }[];
}

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
    lastWorkPlaces: LastWorkPlaceEntry[];
    isFirstJob: boolean;
    familyLists: FamilyListEntry[];
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
    lastWorkPlaces: LastWorkPlaceEntry[];
    isFirstJob: boolean;
    familyLists: FamilyListEntry[];
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
    lastWorkPlace?: LastWorkPlaceEntry[];
    lastWorkPlaces?: LastWorkPlaceEntry[];
    isFirstJob?: boolean;
    familyList?: FamilyListEntry[];
    familyLists?: FamilyListEntry[];
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
    const [date, setDate] = useState(parseZonedDateTime("2024-04-04T00:00[UTC]"));
    const [selectedVacancyId, setSelectedVacancyId] = useState<string>("");
    const [selectedResultStatus, setSelectedResultStatus] = useState<'positive' | 'negative' | 'neutral'>("neutral");
    const [showEducationForm, setShowEducationForm] = useState(!recordId);
    const [educations, setEducations] = useState<EducationEntry[]>([]);
    const [showLastWorkPlaceForm, setShowLastWorkPlaceForm] = useState(!recordId);
    const [lastWorkPlaces, setLastWorkPlaces] = useState<LastWorkPlaceEntry[]>([]);
    const [passDate, setPassDate] = useState<Date>();
    const [isFirstJob, setIsFirstJob] = useState(false);
    const [showFamilyListForm, setShowFamilyListForm] = useState(!recordId);
    const [familyLists, setFamilyLists] = useState<FamilyListEntry[]>([]);

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

            // Cast to unknown first to avoid type errors
            const rawData = (response.data?.data as unknown) as CandidateResponse[];
            if (!rawData) {
                throw new Error('Invalid response from API');
            }
            return {
                data: rawData
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
                console.log('Starting candidate creation with education and work place data:', {
                    candidate: newCandidate,
                    educations: educations,
                    lastWorkPlaces: lastWorkPlaces,
                    isFirstJob: isFirstJob,
                    familyLists: familyLists
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
                    educations: educations,
                    lastWorkPlaces: isFirstJob ? [] : lastWorkPlaces,
                    isFirstJob: isFirstJob,
                    familyLists: familyLists,
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
                    educations: educations,
                    lastWorkPlaces: lastWorkPlaces,
                    isFirstJob: isFirstJob,
                    familyLists: familyLists
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
                    educations?: EducationEntry[];
                    lastWorkPlaces?: LastWorkPlaceEntry[];
                    familyLists?: FamilyListEntry[];
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

                // Всегда добавляем актуальные данные об образовании, местах работы и родственниках
                updateData.educations = educations;
                updateData.lastWorkPlaces = lastWorkPlaces;
                updateData.familyLists = familyLists;

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
                educations: [],
                lastWorkPlaces: [],
                isFirstJob: candidate?.isFirstJob || false,
                familyLists: [],
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
                console.log('Current last work places state before submission:', lastWorkPlaces);

                // Проверяем, есть ли записи об образовании
                if (educations.length === 0) {
                    // Спрашиваем пользователя, хочет ли он продолжить без образования
                    if (!window.confirm("У кандидата не добавлено образование. Продолжить без данных об образовании?")) {
                        // Если пользователь отказался, показываем форму образования
                        setShowEducationForm(true);
                        return;
                    }
                }

                // Include educations and last work places in the submission data
                const submissionData = {
                    ...value,
                    educations: educations,
                    lastWorkPlaces: lastWorkPlaces
                };

                console.log('Submitting candidate data with educations and last work places:', submissionData);

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

    const handleVacancyChange = (value: string) => {
        setSelectedVacancyId(value);
        form.setFieldValue("vacancyId", value || "");
    };

    const handleResultStatusChange = (value: string) => {
        // Create a properly typed variable
        let typedStatus: 'positive' | 'negative' | 'neutral';

        // Assign the correct value based on input
        if (value === 'positive') typedStatus = 'positive';
        else if (value === 'negative') typedStatus = 'negative';
        else typedStatus = 'neutral';

        // Now use the properly typed variable
        setSelectedResultStatus(typedStatus);
        form.setFieldValue("resultStatus", typedStatus);
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

    const handleAddLastWorkPlace = (lastWorkPlace: LastWorkPlaceEntry) => {
        console.log('handleAddLastWorkPlace called with:', lastWorkPlace);
        try {
            const updatedLastWorkPlaces = [...lastWorkPlaces, lastWorkPlace];
            console.log('Updated last work places array:', updatedLastWorkPlaces);
            setLastWorkPlaces(updatedLastWorkPlaces);

            toast({
                title: "Место работы добавлено",
                description: `${lastWorkPlace.organizationName} - ${lastWorkPlace.position}`,
                duration: 3000,
            });
        } catch (error) {
            console.error('Error in handleAddLastWorkPlace:', error);
        }
    };

    const handleRemoveLastWorkPlace = (index: number) => {
        setLastWorkPlaces(lastWorkPlaces.filter((_, i) => i !== index));
    };

    const handleAddFamilyList = (familyList: FamilyListEntry) => {
        console.log('handleAddFamilyList called with:', familyList);
        try {
            const updatedFamilyLists = [...familyLists, familyList];
            console.log('Updated family lists array:', updatedFamilyLists);
            setFamilyLists(updatedFamilyLists);

            toast({
                title: "Родственник добавлен",
                description: `${familyList.familyListName} - ${familyList.familyListRelation}`,
                duration: 3000,
            });
        } catch (error) {
            console.error('Error in handleAddFamilyList:', error);
        }
    };

    const handleRemoveFamilyList = (index: number) => {
        setFamilyLists(familyLists.filter((_, i) => i !== index));
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
                setSelectedVacancyId(candidate.vacancyId);
            }
            if (candidate.resultStatus) {
                setSelectedResultStatus(candidate.resultStatus);
            }
            // if (candidate.birthDate) {
            //     setDate(new Date(candidate.birthDate));
            // }

            // Set education data if available
            if (candidate.education && Array.isArray(candidate.education) && candidate.education.length > 0) {
                console.log('Setting education data from candidate.education:', candidate.education);
                setEducations(candidate.education);
            } else if (candidate.educations && Array.isArray(candidate.educations) && candidate.educations.length > 0) {
                console.log('Setting education data from candidate.educations:', candidate.educations);
                setEducations(candidate.educations);
            }

            // Set last work place data if available
            if (candidate.lastWorkPlace && Array.isArray(candidate.lastWorkPlace) && candidate.lastWorkPlace.length > 0) {
                console.log('Setting last work place data from candidate.lastWorkPlace:', candidate.lastWorkPlace);
                setLastWorkPlaces(candidate.lastWorkPlace);
                setIsFirstJob(false);
            } else if (candidate.lastWorkPlaces && Array.isArray(candidate.lastWorkPlaces) && candidate.lastWorkPlaces.length > 0) {
                console.log('Setting last work place data from candidate.lastWorkPlaces:', candidate.lastWorkPlaces);
                setLastWorkPlaces(candidate.lastWorkPlaces);
                setIsFirstJob(false);
            } else {
                // Если нет данных о местах работы, возможно это первое место работы
                setIsFirstJob(candidate.isFirstJob || false);
            }

            // Set family list data if available
            if (candidate.familyList && Array.isArray(candidate.familyList) && candidate.familyList.length > 0) {
                console.log('Setting family list data from candidate.familyList:', candidate.familyList);
                setFamilyLists(candidate.familyList);
            } else if (candidate.familyLists && Array.isArray(candidate.familyLists) && candidate.familyLists.length > 0) {
                console.log('Setting family list data from candidate.familyLists:', candidate.familyLists);
                setFamilyLists(candidate.familyLists);
            }
        }
    }, [candidateQuery.data, form]);

    const handleSubmit = async (e: React.FormEvent) => {
        try {
            e.preventDefault();
            e.stopPropagation();

            // Обновляем значение isFirstJob в форме перед отправкой
            form.setFieldValue("isFirstJob", isFirstJob);

            await form.handleSubmit();
        } catch (error) {
            console.error('Error in handleSubmit:', error);
        }
    };

    const handleCalendarChange = (_value: string | number, _e: React.ChangeEventHandler<HTMLSelectElement>) => {
        const _event = {
            target: {
                value: String(_value),
            },
        } as React.ChangeEvent<HTMLSelectElement>
        _e(_event)
    }

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
                                value={field.getValue() ?? ""}
                                onValueChange={handleVacancyChange}
                                disabled={vacanciesQuery.isLoading}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Выберите вакансию" />
                                </SelectTrigger>
                                <SelectContent>
                                    {vacanciesQuery.data?.data ? vacanciesQuery.data.data.map((vacancy: any) => (
                                        <SelectItem key={vacancy.id} value={vacancy.id}>
                                            {vacancy.applicationNum} - {vacancy.position}
                                        </SelectItem>
                                    )) : []}
                                </SelectContent>
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
                        {(field) => {
                            let date = field.getValue() ?? new Date();
                            return (
                                <Popover>
                                    {/* <PopoverTrigger className={cn(
                                        "w-full justify-start text-left font-normal flex items-center p-2 border rounded-md",
                                        !date && "text-muted-foreground"
                                    )}>
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {date ? format(date, "PPP") : <span>Выберите дату</span>}
                                    </PopoverTrigger> */}
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
                                    <PopoverContent className="w-auto p-0"
                                        container={formRef.current!}
                                    >
                                        <CalendarOrigin
                                            mode="single"
                                            // @ts-ignore
                                            selected={date}
                                            onSelect={(date) => {
                                                if (date) {
                                                    field.handleChange(format(date, "yyyy-MM-dd"));
                                                } else {
                                                    field.handleChange("");
                                                }
                                            }}
                                            className="rounded-md border p-2"
                                            classNames={{
                                                month_caption: "mx-0",
                                            }}
                                            captionLayout="dropdown"
                                            defaultMonth={new Date()}
                                            startMonth={new Date(1980, 6)}
                                            hideNavigation
                                            components={{
                                                // @ts-ignore
                                                DropdownNav: (props: DropdownNavProps) => {
                                                    return <div className="flex w-full items-center gap-2">{props.children}</div>
                                                },
                                                // @ts-ignore
                                                Dropdown: (props: DropdownProps) => {
                                                    return (
                                                        <Select
                                                            value={String(props.value)}
                                                            onValueChange={(value) => {
                                                                if (props.onChange) {
                                                                    // @ts-ignore
                                                                    handleCalendarChange(value, props.onChange)
                                                                }
                                                            }}
                                                        >
                                                            <SelectTrigger className="h-8 w-fit font-medium first:grow">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent className="max-h-[min(26rem,var(--radix-select-content-available-height))]">
                                                                {props.options?.map((option) => (
                                                                    <SelectItem key={option.value} value={String(option.value)} disabled={option.disabled}>
                                                                        {option.label}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    )
                                                },
                                            }}
                                        />
                                    </PopoverContent>
                                </Popover>

                            )
                        }}
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
                        {(field) => {
                            let date = field.getValue() ?? new Date();

                            return (
                                <Popover>
                                    {/* <PopoverTrigger className={cn(
                                        "w-full justify-start text-left font-normal flex items-center p-2 border rounded-md",
                                        !date && "text-muted-foreground"
                                    )}>
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {date ? format(date, "PPP") : <span>Выберите дату</span>}
                                    </PopoverTrigger> */}
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
                                    <PopoverContent className="w-auto p-0"
                                        container={formRef.current!}
                                    >
                                        <CalendarOrigin
                                            mode="single"
                                            // @ts-ignore
                                            selected={date}
                                            onSelect={(date) => {
                                                if (date) {
                                                    field.handleChange(format(date, "yyyy-MM-dd"));
                                                } else {
                                                    field.handleChange("");
                                                }
                                            }}
                                            className="rounded-md border p-2"
                                            classNames={{
                                                month_caption: "mx-0",
                                            }}
                                            captionLayout="dropdown"
                                            defaultMonth={new Date()}
                                            startMonth={new Date(1980, 6)}
                                            hideNavigation
                                            components={{
                                                // @ts-ignore
                                                DropdownNav: (props: DropdownNavProps) => {
                                                    return <div className="flex w-full items-center gap-2">{props.children}</div>
                                                },
                                                // @ts-ignore
                                                Dropdown: (props: DropdownProps) => {
                                                    return (
                                                        <Select
                                                            value={String(props.value)}
                                                            onValueChange={(value) => {
                                                                if (props.onChange) {
                                                                    // @ts-ignore
                                                                    handleCalendarChange(value, props.onChange)
                                                                }
                                                            }}
                                                        >
                                                            <SelectTrigger className="h-8 w-fit font-medium first:grow">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                            <SelectContent className="max-h-[min(26rem,var(--radix-select-content-available-height))]">
                                                                {props.options?.map((option) => (
                                                                    <SelectItem key={option.value} value={String(option.value)} disabled={option.disabled}>
                                                                        {option.label}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    )
                                                },
                                            }}
                                        />
                                    </PopoverContent>
                                </Popover>
                                // <Popover>
                                //     <PopoverTrigger asChild>
                                //         <Button
                                //             variant={"outline"}
                                //             className={cn(
                                //                 "w-full justify-start text-left font-normal",
                                //                 !passDate && "text-muted-foreground"
                                //             )}
                                //             aria-label="Select date"
                                //         >
                                //             <CalendarIcon className="mr-2 h-4 w-4" />
                                //             {passDate ? format(passDate, "PPP") : <span>Выберите дату</span>}
                                //         </Button>
                                //     </PopoverTrigger>
                                //     <PopoverContent className="w-auto p-0">
                                //         <Calendar
                                //             mode="single"
                                //             selected={passDate}
                                //             onSelect={(date) => {
                                //                 setPassDate(date);
                                //                 if (date) {
                                //                     field.handleChange(format(date, "yyyy-MM-dd"));
                                //                 }
                                //             }}
                                //             initialFocus
                                //         />
                                //     </PopoverContent>
                                // </Popover>


                            )
                        }}
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
                                value={field.getValue() ?? "neutral"}
                                onValueChange={handleResultStatusChange}
                            >
                                <SelectTrigger className="w-full">
                                    <SelectValue placeholder="Выберите статус результата" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="positive">Положительный</SelectItem>
                                    <SelectItem value="negative">Отрицательный</SelectItem>
                                    <SelectItem value="neutral">Нейтральный</SelectItem>
                                </SelectContent>
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

            {/* Добавляем секцию для последнего места работы */}
            <div className="space-y-4">
                <div className="flex justify-between items-center border-t pt-4 mt-4">
                    <Label className="text-lg font-bold">Места работы</Label>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center space-x-2">
                            <input
                                type="checkbox"
                                id="isFirstJob"
                                checked={isFirstJob}
                                onChange={(e) => {
                                    setIsFirstJob(e.target.checked);
                                    if (e.target.checked) {
                                        // Если это первое место работы, очищаем список мест работы
                                        setLastWorkPlaces([]);
                                        setShowLastWorkPlaceForm(false);
                                    }
                                }}
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                            />
                            <Label htmlFor="isFirstJob" className="text-sm font-medium">
                                Это первое место работы
                            </Label>
                        </div>
                        {!isFirstJob && (
                            <Button
                                type="button"
                                variant={showLastWorkPlaceForm ? "outline" : "default"}
                                size="sm"
                                onClick={() => setShowLastWorkPlaceForm(!showLastWorkPlaceForm)}
                                className="flex items-center gap-2"
                            >
                                {showLastWorkPlaceForm ? "Скрыть форму" : `Добавить место работы ${lastWorkPlaces.length > 0 ? `(${lastWorkPlaces.length})` : ''}`}
                            </Button>
                        )}
                    </div>
                </div>

                {!isFirstJob && showLastWorkPlaceForm && (
                    <div className="mt-2 p-4 border rounded-md">
                        <div onClick={(e) => e.stopPropagation()}>
                            <LastWorkPlaceForm
                                entries={lastWorkPlaces}
                                onAdd={handleAddLastWorkPlace}
                                onRemove={handleRemoveLastWorkPlace}
                            />
                        </div>
                    </div>
                )}

                {/* Отображаем список добавленных записей даже если форма скрыта */}
                {!isFirstJob && lastWorkPlaces.length > 0 && !showLastWorkPlaceForm && (
                    <div className="mt-2 p-4 border rounded-md">
                        <p className="font-medium mb-2">Добавленные записи о местах работы: {lastWorkPlaces.length}</p>
                        <ul className="list-disc pl-5">
                            {lastWorkPlaces.map((work, index) => (
                                <li key={index} className="mb-1">
                                    {work.organizationName} - {work.position} ({format(new Date(work.employmentDate), "dd.MM.yyyy")} - {format(new Date(work.dismissalDate), "dd.MM.yyyy")})
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleRemoveLastWorkPlace(index)}
                                        className="ml-2 h-6 text-red-500 hover:text-red-700"
                                    >
                                        Удалить
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {isFirstJob && (
                    <div className="mt-2 p-4 border rounded-md bg-gray-50">
                        <p className="text-gray-600 italic">
                            Информация о предыдущих местах работы не требуется, так как это первое место работы кандидата.
                        </p>
                    </div>
                )}
            </div>

            {/* После секции с местами работы добавляем секцию для родственников */}
            <div className="space-y-4">
                <div className="flex justify-between items-center border-t pt-4 mt-4">
                    <Label className="text-lg font-bold">Ближайшие родственники</Label>
                    <Button
                        type="button"
                        variant={showFamilyListForm ? "outline" : "default"}
                        size="sm"
                        onClick={() => setShowFamilyListForm(!showFamilyListForm)}
                        className="flex items-center gap-2"
                    >
                        {showFamilyListForm ? "Скрыть форму" : `Добавить родственника ${familyLists.length > 0 ? `(${familyLists.length})` : ''}`}
                    </Button>
                </div>

                {showFamilyListForm && (
                    <div className="mt-2 p-4 border rounded-md">
                        <div onClick={(e) => e.stopPropagation()}>
                            <FamilyListForm
                                entries={familyLists}
                                onAdd={handleAddFamilyList}
                                onRemove={handleRemoveFamilyList}
                            />
                        </div>
                    </div>
                )}

                {/* Отображаем список добавленных родственников даже если форма скрыта */}
                {familyLists.length > 0 && !showFamilyListForm && (
                    <div className="mt-2 p-4 border rounded-md">
                        <p className="font-medium mb-2">Добавленные родственники: {familyLists.length}</p>
                        <ul className="list-disc pl-5">
                            {familyLists.map((family, index) => (
                                <li key={index} className="mb-1">
                                    {family.familyListName} - {family.familyListRelation}
                                    {family.familyListBirthDate && ` (${format(new Date(family.familyListBirthDate), "dd.MM.yyyy")})`}
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => handleRemoveFamilyList(index)}
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