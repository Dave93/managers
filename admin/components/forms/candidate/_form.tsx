'use client';
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { useMemo, useRef, useState, useEffect } from "react";
import { Loader2, CalendarIcon, Trash2 } from "lucide-react";
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
import React from "react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@components/ui/select";
import { CalendarOrigin } from "@admin/components/ui/calendarOrigin";
import { DropdownNavProps, DropdownProps } from "react-day-picker";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@components/ui/alert-dialog";

// Helper function for calendar dropdown changes
const handleCalendarChange = (_value: string | number, _e: React.ChangeEventHandler<HTMLSelectElement>) => {
    const _event = {
        target: {
            value: String(_value),
        },
    } as React.ChangeEvent<HTMLSelectElement>
    _e(_event)
}

// Helper functions for API data formatting
const formatDateForApi = (dateStr: string | undefined | null): string => {
    if (!dateStr) return '';
    
    try {
        // If it already looks like a proper ISO date, return it
        if (dateStr.includes('T')) return dateStr;
        
        // If it's in yyyy-MM-dd format, convert to ISO
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
            console.warn('Invalid date:', dateStr);
            return dateStr;
        }
        
        // Format as YYYY-MM-DD (without time component)
        return format(date, 'yyyy-MM-dd');
    } catch (e) {
        console.error('Error formatting date:', dateStr, e);
        return dateStr;
    }
};

// Helper to ensure values are strings
const ensureString = (value: any): string => {
    if (value === null || value === undefined) return '';
    return String(value);
};

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
    const queryClient = useQueryClient();
    const [selectedVacancyId, setSelectedVacancyId] = useState<string>("");
    const [selectedResultStatus, setSelectedResultStatus] = useState<'positive' | 'negative' | 'neutral'>("neutral");
    const [showEducationForm, setShowEducationForm] = useState(!recordId);
    const [educations, setEducations] = useState<EducationEntry[]>([]);
    const [showLastWorkPlaceForm, setShowLastWorkPlaceForm] = useState(!recordId);
    const [lastWorkPlaces, setLastWorkPlaces] = useState<LastWorkPlaceEntry[]>([]);
    const [isFirstJob, setIsFirstJob] = useState(false);
    const [showFamilyListForm, setShowFamilyListForm] = useState(!recordId);
    const [familyLists, setFamilyLists] = useState<FamilyListEntry[]>([]);


    // Add positions query
    const vacanciesQuery = useQuery({
        queryKey: ['vacancies'],
        queryFn: async () => {
            const response = await apiClient.api.vacancy.get({
                query: {
                    limit: '100',
                    offset: '0'
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
        toast.success(`Кандидат ${actionText}`);
        queryClient.invalidateQueries({ queryKey: ["candidates"] });
        closeForm();
    };

    const onError = (error: any) => {
        toast.error(error.message);
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
                    email: ensureString(newCandidate.email),
                    citizenship: ensureString(newCandidate.citizenship),
                    residence: ensureString(newCandidate.residence),
                    passportNumber: ensureString(newCandidate.passportNumber),
                    passportSeries: ensureString(newCandidate.passportSeries),
                    passportIdDate: newCandidate.passportIdDate ? formatDateForApi(newCandidate.passportIdDate) : "",
                    passportIdPlace: ensureString(newCandidate.passportIdPlace),
                    source: ensureString(newCandidate.source),
                    familyStatus: ensureString(newCandidate.familyStatus),
                    children: newCandidate.children || 0,
                    language: ensureString(newCandidate.language),
                    desiredSalary: ensureString(newCandidate.desiredSalary),
                    desiredSchedule: ensureString(newCandidate.desiredSchedule),
                    purpose: ensureString(newCandidate.purpose),
                    strengthsShortage: ensureString(newCandidate.strengthsShortage),
                    relatives: ensureString(newCandidate.relatives),
                    desiredPosition: ensureString(newCandidate.desiredPosition),
                    resultStatus: newCandidate.resultStatus as 'positive' | 'negative' | 'neutral' || 'neutral',
                    educations: educations.map(edu => ({
                        ...edu,
                        dateStart: formatDateForApi(edu.dateStart),
                        dateEnd: formatDateForApi(edu.dateEnd),
                        educationType: ensureString(edu.educationType),
                        university: ensureString(edu.university),
                        speciality: ensureString(edu.speciality)
                    })),
                    lastWorkPlaces: isFirstJob ? [] : lastWorkPlaces.map(work => ({
                        ...work,
                        employmentDate: formatDateForApi(work.employmentDate),
                        dismissalDate: formatDateForApi(work.dismissalDate),
                        lastWorkPlace: ensureString(work.lastWorkPlace),
                        experience: ensureString(work.experience),
                        organizationName: ensureString(work.organizationName),
                        position: ensureString(work.position),
                        addressOrg: ensureString(work.addressOrg),
                        dismissalReason: ensureString(work.dismissalReason)
                    })),
                    isFirstJob: isFirstJob,
                    familyLists: familyLists.map(family => ({
                        ...family,
                        familyListBirthDate: formatDateForApi(family.familyListBirthDate),
                        familyListName: ensureString(family.familyListName),
                        familyListPhone: ensureString(family.familyListPhone),
                        familyListRelation: ensureString(family.familyListRelation),
                        familyListAddress: ensureString(family.familyListAddress),
                        familyJob: ensureString(family.familyJob)
                    })),
                };

                console.log('Sending formatted data to API:', formattedData);
                console.log('API request payload:', JSON.stringify(formattedData, null, 2));

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
                
                // Показать подробное сообщение об ошибке валидации, если оно есть
                if (error.response?.data?.errors) {
                    const validationErrors = error.response.data.errors;
                    console.error('Validation errors:', validationErrors);
                    
                    // Формируем читабельное сообщение об ошибках
                    let errorMessage = "Ошибка валидации: ";
                    if (Array.isArray(validationErrors)) {
                        errorMessage += validationErrors.map(err => 
                            `${err.path}: ${err.message}`
                        ).join("; ");
                    } else {
                        errorMessage += JSON.stringify(validationErrors);
                    }
                    
                    throw new Error(errorMessage);
                }
                
                throw error;
            }
        },
        onSuccess: () => onAddSuccess("добавлен успешно"),
        onError: (error: any) => {
            console.error('Mutation error:', error);
            toast.error(error.message || "Не удалось создать кандидата");
        },
    });

    const updateMutation = useMutation({
        mutationFn: async (params: {
            data: CandidateFormData;
            id: string
        }) => {
            try {
                console.log('Starting update with data:', params.data);
                console.log('Current educations:', educations);
                console.log('Current work places:', lastWorkPlaces);
                console.log('Current family lists:', familyLists);
                console.log('isFirstJob flag:', isFirstJob);

                // Get current data from API (this is just for logging and comparison)
                const currentData = candidateQuery.data?.data?.[0];
                if (!currentData) {
                    console.warn("Current candidate data not found, proceeding with update anyway");
                }

                // Format dates properly if they exist
                let formattedData = { ...params.data };
                
                // Ensure dates are in yyyy-MM-dd format without time component
                if (formattedData.birthDate) {
                    formattedData.birthDate = formatDateForApi(formattedData.birthDate);
                }
                
                if (formattedData.passportIdDate) {
                    formattedData.passportIdDate = formatDateForApi(formattedData.passportIdDate);
                }

                // Ensure desiredSalary is a string
                formattedData.desiredSalary = ensureString(formattedData.desiredSalary);

                // Prepare update data with all form fields plus our current collections
                const updateData = {
                    ...formattedData,
                    educations: educations.map(edu => ({
                        ...edu,
                        // Ensure education dates are properly formatted
                        dateStart: formatDateForApi(edu.dateStart),
                        dateEnd: formatDateForApi(edu.dateEnd)
                    })),
                    lastWorkPlaces: isFirstJob ? [] : lastWorkPlaces.map(work => ({
                        ...work,
                        // Ensure work dates are properly formatted
                        employmentDate: formatDateForApi(work.employmentDate),
                        dismissalDate: formatDateForApi(work.dismissalDate),
                        // Ensure all string fields are actually strings
                        lastWorkPlace: ensureString(work.lastWorkPlace),
                        experience: ensureString(work.experience),
                        organizationName: ensureString(work.organizationName),
                        position: ensureString(work.position),
                        addressOrg: ensureString(work.addressOrg),
                        dismissalReason: ensureString(work.dismissalReason)
                    })),
                    isFirstJob: isFirstJob,
                    familyLists: familyLists.map(family => ({
                        ...family,
                        // Ensure family birth dates are properly formatted
                        familyListBirthDate: formatDateForApi(family.familyListBirthDate),
                        // Ensure all string fields are actually strings
                        familyListName: ensureString(family.familyListName),
                        familyListPhone: ensureString(family.familyListPhone),
                        familyListRelation: ensureString(family.familyListRelation),
                        familyListAddress: ensureString(family.familyListAddress),
                        familyJob: ensureString(family.familyJob)
                    }))
                };

                console.log('Sending update data to API:', updateData);
                
                // Debug the exact data structure being sent
                console.log('API request payload:', JSON.stringify(updateData, null, 2));
                
                return await apiClient.api.candidates({ id: params.id }).put(updateData);
            } catch (error) {
                console.error('Error in updateMutation:', error);
                throw error;
            }
        },
        onSuccess: () => onAddSuccess("обновлен успешно"),
        onError: (error: any) => {
            console.error('Update error:', error);
            if (error.response) {
                console.error('Response error data:', error.response.data);
                
                // Показать подробное сообщение об ошибке валидации, если оно есть
                if (error.response.data?.errors) {
                    const validationErrors = error.response.data.errors;
                    console.error('Validation errors:', validationErrors);
                    
                    // Формируем читабельное сообщение об ошибках
                    let errorMessage = "Ошибка валидации: ";
                    if (Array.isArray(validationErrors)) {
                        errorMessage += validationErrors.map(err => 
                            `${err.path}: ${err.message}`
                        ).join("; ");
                    } else {
                        errorMessage += JSON.stringify(validationErrors);
                    }
                    
                    toast.error(errorMessage);
                    return;
                }
            }
            toast.error(error.message || "Не удалось обновить кандидата");
        },
    });

    const deleteMutation = useMutation({
        mutationFn: async (id: string) => {
            try {
                console.log('Deleting candidate and all related data for ID:', id);
                const response = await apiClient.api.candidates({ id: id }).delete();
                return response.data;
            } catch (error) {
                console.error('Error in delete mutation:', error);
                throw error;
            }
        },
        onSuccess: () => {
            toast.success("Кандидат и все связанные данные удалены");
            queryClient.invalidateQueries({ queryKey: ["candidates"] });
            closeForm();
        },
        onError: (error: any) => {
            console.error('Delete mutation error:', error);
            toast.error(error.message || "Не удалось удалить кандидата");
        },
    });

    const handleDelete = async () => {
        if (!recordId) {
            toast.error("ID кандидата не найден");
            return;
        }
        
        try {
            await deleteMutation.mutateAsync(recordId);
        } catch (error) {
            console.error('Error in handleDelete:', error);
        }
    };

    // @ts-ignore
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
                toast.error("Пожалуйста, выберите вакансию");
                return;
            }

            if (!value.fullName) {
                toast.error("ФИО обязательно для заполнения");
                return;
            }

            if (!value.phoneNumber) {
                toast.error("Номер телефона обязателен для заполнения");
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
        if (value !== 'positive' && value !== 'negative' && value !== 'neutral') {
            console.error('Invalid result status value:', value);
            return;
        }
        
        setSelectedResultStatus(value);
        form.setFieldValue("resultStatus", value);
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
            toast.success(`Образование добавлено`);
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

            toast.success(`Место работы добавлено`);
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

            toast.success(`Родственник добавлен`);
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
            console.log('Initializing form with candidate data:', candidate);

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

            // Set firstJob flag
            setIsFirstJob(candidate.isFirstJob || false);

            // Handle education data
            let educationData: EducationEntry[] = [];
            if (candidate.education && Array.isArray(candidate.education) && candidate.education.length > 0) {
                console.log('Setting education data from candidate.education:', candidate.education);
                educationData = candidate.education;
            } else if (candidate.educations && Array.isArray(candidate.educations) && candidate.educations.length > 0) {
                console.log('Setting education data from candidate.educations:', candidate.educations);
                educationData = candidate.educations;
            }
            
            if (educationData.length > 0) {
                setEducations(educationData);
                // Don't show education form initially if we already have data
                setShowEducationForm(false);
            }

            // Handle work experience data
            let workPlaceData: LastWorkPlaceEntry[] = [];
            if (candidate.lastWorkPlace && Array.isArray(candidate.lastWorkPlace) && candidate.lastWorkPlace.length > 0) {
                console.log('Setting last work place data from candidate.lastWorkPlace:', candidate.lastWorkPlace);
                workPlaceData = candidate.lastWorkPlace;
            } else if (candidate.lastWorkPlaces && Array.isArray(candidate.lastWorkPlaces) && candidate.lastWorkPlaces.length > 0) {
                console.log('Setting last work place data from candidate.lastWorkPlaces:', candidate.lastWorkPlaces);
                workPlaceData = candidate.lastWorkPlaces;
            }
            
            if (workPlaceData.length > 0) {
                setLastWorkPlaces(workPlaceData);
                // Don't show work experience form initially if we already have data
                setShowLastWorkPlaceForm(false);
            }

            // Handle family data
            let familyData: FamilyListEntry[] = [];
            if (candidate.familyList && Array.isArray(candidate.familyList) && candidate.familyList.length > 0) {
                console.log('Setting family list data from candidate.familyList:', candidate.familyList);
                familyData = candidate.familyList;
            } else if (candidate.familyLists && Array.isArray(candidate.familyLists) && candidate.familyLists.length > 0) {
                console.log('Setting family list data from candidate.familyLists:', candidate.familyLists);
                familyData = candidate.familyLists;
            }
            
            if (familyData.length > 0) {
                setFamilyLists(familyData);
                // Don't show family form initially if we already have data
                setShowFamilyListForm(false);
            }
        }
    }, [candidateQuery.data, form]);

    const handleSubmit = async (e: React.FormEvent) => {
        try {
            e.preventDefault();
            e.stopPropagation();

            // Обновляем значение isFirstJob в форме перед отправкой
            form.setFieldValue("isFirstJob", isFirstJob);

            // Log submission attempt
            console.log('Submitting form with educations:', educations);
            console.log('Submitting form with lastWorkPlaces:', lastWorkPlaces);
            console.log('Submitting form with familyLists:', familyLists);
            console.log('Submitting form with isFirstJob:', isFirstJob);

            // Execute form submission
            await form.handleSubmit();
        } catch (error: any) {
            console.error('Error in handleSubmit:', error);
            
            // More detailed error handling
            if (error.response) {
                console.error('Response error data:', error.response.data);
                const errorMessage = error.response.data?.message || error.message || "Ошибка при отправке формы";
                toast.error(errorMessage);
            } else {
                toast.error("Ошибка при отправке формы");
            }
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
            className="space-y-4 p-4"
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
                                            {vacancy.applicationNum}
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
                            const dateValue = field.getValue() ? new Date(field.getValue()) : undefined;
                            return (
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant={"outline"}
                                            className={cn(
                                                "w-full justify-start text-left font-normal",
                                                !dateValue && "text-muted-foreground"
                                            )}
                                            aria-label="Select date"
                                        >
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {dateValue ? format(dateValue, "PPP") : <span>Выберите дату</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0"
                                        container={formRef.current!}
                                    >
                                        <CalendarOrigin
                                            mode="single"
                                            selected={dateValue}
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
                                            defaultMonth={dateValue || new Date()}
                                            startMonth={new Date(1950, 1)}
                                            hideNavigation
                                            components={{
                                                DropdownNav: (props: DropdownNavProps) => {
                                                    return <div className="flex w-full items-center gap-2">{props.children}</div>
                                                },
                                                Dropdown: (props: DropdownProps) => {
                                                    return (
                                                        <Select
                                                            value={String(props.value)}
                                                            onValueChange={(value) => {
                                                                if (props.onChange) {
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
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Дата выдачи паспорта</Label>
                    <form.Field name="passportIdDate">
                        {(field) => {
                            const dateValue = field.getValue() ? new Date(field.getValue()) : undefined;
                            return (
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant={"outline"}
                                            className={cn(
                                                "w-full justify-start text-left font-normal",
                                                !dateValue && "text-muted-foreground"
                                            )}
                                            aria-label="Select date"
                                        >
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {dateValue ? format(dateValue, "PPP") : <span>Выберите дату</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0"
                                        container={formRef.current!}
                                    >
                                        <CalendarOrigin
                                            mode="single"
                                            selected={dateValue}
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
                                            defaultMonth={dateValue || new Date()}
                                            startMonth={new Date(1950, 1)}
                                            hideNavigation
                                            components={{
                                                DropdownNav: (props: DropdownNavProps) => {
                                                    return <div className="flex w-full items-center gap-2">{props.children}</div>
                                                },
                                                Dropdown: (props: DropdownProps) => {
                                                    return (
                                                        <Select
                                                            value={String(props.value)}
                                                            onValueChange={(value) => {
                                                                if (props.onChange) {
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

            {/* <div className="space-y-2">
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
            </div> */}

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
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleRemoveEducation(index);
                                        }}
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
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleRemoveLastWorkPlace(index);
                                        }}
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
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleRemoveFamilyList(index);
                                        }}
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

            <div className="flex space-x-4">
                <Button
                    type="button"
                    variant="outline"
                    onClick={closeForm}
                    aria-label="Отменить форму"
                >
                    Отмена
                </Button>
                
                {recordId && (
                    <AlertDialog>
                        <AlertDialogTrigger asChild>
                            <Button
                                type="button"
                                variant="destructive"
                                aria-label="Удалить кандидата"
                                className="mr-auto"
                            >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Удалить
                            </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Вы уверены?</AlertDialogTitle>
                                <AlertDialogDescription>
                                    Это действие нельзя отменить. Кандидат и все связанные данные (образование, опыт работы, родственники) будут удалены.
                                </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                                <AlertDialogCancel>Отмена</AlertDialogCancel>
                                <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                                    {deleteMutation.isPending ? (
                                        <>
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            Удаление...
                                        </>
                                    ) : (
                                        "Удалить"
                                    )}
                                </AlertDialogAction>
                            </AlertDialogFooter>
                        </AlertDialogContent>
                    </AlertDialog>
                )}
                
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