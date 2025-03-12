"use client";

import { Button } from "@admin/components/ui/buttonOrigin";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { useState, useRef } from "react";
import { CalendarIcon, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@admin/components/ui/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@components/ui/popover";
import { cn } from "@admin/lib/utils";
import { Textarea } from "@components/ui/textarea";
import { DropdownNavProps } from "react-day-picker";
import { SelectValue } from "@admin/components/ui/select";
import { SelectTrigger } from "@admin/components/ui/select";
import { SelectItem } from "@admin/components/ui/select";
import { SelectContent } from "@admin/components/ui/select";
import { DropdownProps } from "react-day-picker";
import { Select } from "@admin/components/ui/select";
import { CalendarOrigin } from "@admin/components/ui/calendarOrigin";

export interface LastWorkPlaceEntry {
    lastWorkPlace: string;
    dismissalDate: string;
    employmentDate: string;
    experience: string;
    organizationName: string;
    position: string;
    addressOrg: string;
    dismissalReason: string;
}

interface LastWorkPlaceFormProps {
    onAdd: (lastWorkPlace: LastWorkPlaceEntry) => void;
    onRemove: (index: number) => void;
    entries: LastWorkPlaceEntry[];
}

const handleCalendarChange = (_value: string | number, _e: React.ChangeEventHandler<HTMLSelectElement>) => {
    const _event = {
        target: {
            value: String(_value),
        },
    } as React.ChangeEvent<HTMLSelectElement>
    _e(_event)
}

export default function LastWorkPlaceForm({ onAdd, onRemove, entries }: LastWorkPlaceFormProps) {
    const formRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    const [lastWorkPlace, setLastWorkPlace] = useState("");
    const [organizationName, setOrganizationName] = useState("");
    const [position, setPosition] = useState("");
    const [addressOrg, setAddressOrg] = useState("");
    const [experience, setExperience] = useState("");
    const [dismissalReason, setDismissalReason] = useState("");

    const [employmentDate, setEmploymentDate] = useState("");
    const [dismissalDate, setDismissalDate] = useState("");

    const handleAdd = (e?: React.MouseEvent) => {
        try {
            // Prevent any form submission if this is triggered by an event
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            console.log('Adding last work place with data:', {
                lastWorkPlace,
                organizationName,
                position,
                addressOrg,
                experience,
                dismissalReason,
                employmentDate,
                dismissalDate
            });

            // Validate required fields
            const missingFields = [];
            if (!organizationName) missingFields.push("Наименование организации");
            if (!position) missingFields.push("Должность");
            if (!employmentDate) missingFields.push("Дата приема на работу");
            if (!dismissalDate) missingFields.push("Дата увольнения");

            if (missingFields.length > 0) {
                console.error('Validation failed: Missing required fields', {
                    lastWorkPlace,
                    organizationName,
                    position,
                    addressOrg,
                    experience,
                    dismissalReason,
                    employmentDate,
                    dismissalDate
                });
                toast({
                    title: "Ошибка",
                    description: `Пожалуйста, заполните следующие поля: ${missingFields.join(", ")}`,
                    variant: "destructive",
                });
                return;
            }

            // Validate dates
            const startDate = new Date(employmentDate);
            const endDate = new Date(dismissalDate);

            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                console.error('Validation failed: Invalid dates', {
                    employmentDate,
                    dismissalDate,
                    startDate,
                    endDate
                });
                toast({
                    title: "Ошибка",
                    description: "Пожалуйста, введите корректные даты",
                    variant: "destructive",
                });
                return;
            }

            if (endDate < startDate) {
                console.error('Validation failed: End date before start date', {
                    startDate,
                    endDate
                });
                toast({
                    title: "Ошибка",
                    description: "Дата увольнения не может быть раньше даты приема на работу",
                    variant: "destructive",
                });
                return;
            }

            const formattedData = {
                lastWorkPlace: lastWorkPlace || organizationName,
                organizationName,
                position,
                addressOrg,
                experience,
                dismissalReason,
                employmentDate: format(startDate, "yyyy-MM-dd"),
                dismissalDate: format(endDate, "yyyy-MM-dd")
            };

            console.log('Adding formatted last work place data:', formattedData);

            // Вызов функции onAdd для добавления записи в родительский компонент
            onAdd(formattedData);

            // Показываем сообщение об успехе
            toast({
                title: "Успешно",
                description: "Запись о месте работы добавлена",
            });

            // Reset form
            setLastWorkPlace("");
            setOrganizationName("");
            setPosition("");
            setAddressOrg("");
            setExperience("");
            setDismissalReason("");
            setEmploymentDate("");
            setDismissalDate("");
        } catch (error: any) {
            console.error('Error adding last work place:', {
                message: error?.message || 'Unknown error',
                stack: error?.stack || 'No stack trace',
                formData: {
                    lastWorkPlace,
                    organizationName,
                    position,
                    addressOrg,
                    experience,
                    dismissalReason,
                    employmentDate,
                    dismissalDate
                }
            });
            toast({
                title: "Ошибка",
                description: "Произошла ошибка при добавлении места работы",
                variant: "destructive",
            });
        }
    };
    return (
        <div
            className="space-y-4"
            ref={formRef}
            onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }}
        >
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Записи о местах работы</h2>
            </div>

            {entries.length > 0 && (
                <div className="p-3 rounded-md mb-4">
                    <p className="font-medium text-green-700">Добавлено записей: {entries.length}</p>
                    <ul className="list-disc pl-5 mt-2">
                        {entries.map((entry, index) => (
                            <li key={index} className="text-sm text-green-800 mb-1">
                                {entry.organizationName} - {entry.position} ({format(new Date(entry.employmentDate), "dd.MM.yyyy")} - {format(new Date(entry.dismissalDate), "dd.MM.yyyy")})
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onRemove(index);
                                    }}
                                    className="ml-2 h-6 text-red-500 hover:text-red-700"
                                >
                                    <Trash2 className="h-3 w-3 mr-1" /> Удалить
                                </Button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="grid grid-cols-2 gap-4 p-4 rounded-lg border border-border">
                <h3 className="col-span-2 font-semibold text-lg border-b pb-2 mb-2">Добавить новое место работы</h3>

                <div className="space-y-2">
                    <Label className="flex items-center">
                        Наименование организации <span className="text-red-500 ml-1">*</span>
                    </Label>
                    <Input
                        value={organizationName}
                        onChange={(e) => setOrganizationName(e.target.value)}
                        placeholder="Введите название организации"
                    />
                </div>
                <div className="space-y-2">
                    <Label className="flex items-center">
                        Должность <span className="text-red-500 ml-1">*</span>
                    </Label>
                    <Input
                        value={position}
                        onChange={(e) => setPosition(e.target.value)}
                        placeholder="Введите должность"
                    />
                </div>

                <div className="space-y-2">
                    <Label className="flex items-center">
                        Дата приема на работу <span className="text-red-500 ml-1">*</span>
                    </Label>
                    <Popover>
                        <PopoverTrigger className="w-full">
                            <Button
                                type="button"
                                variant={"outline"}
                                className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !employmentDate && "text-muted-foreground"
                                )}
                                aria-label="Select date"
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {employmentDate ? format(employmentDate, "PPP") : <span>Выберите дату</span>}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0"
                            container={formRef.current!}
                        >

                            <CalendarOrigin
                                mode="single"
                                selected={employmentDate ? new Date(employmentDate) : undefined}
                                onSelect={(date) => {
                                    if (date) {
                                        setEmploymentDate(format(date, "yyyy-MM-dd"));
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
                </div>
                <div className="space-y-2">
                    <Label className="flex items-center">
                        Дата увольнения <span className="text-red-500 ml-1">*</span>
                    </Label>
                    <Popover>
                        <PopoverTrigger className="w-full">
                            <Button
                                type="button"
                                variant={"outline"}
                                className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !dismissalDate && "text-muted-foreground"
                                )}
                                aria-label="Select date"
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {dismissalDate ? format(dismissalDate, "PPP") : <span>Выберите дату</span>}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0"
                            container={formRef.current!}
                        >

                            <CalendarOrigin
                                mode="single"
                                selected={dismissalDate ? new Date(dismissalDate) : undefined}
                                onSelect={(date) => {
                                    if (date) {
                                        setDismissalDate(format(date, "yyyy-MM-dd"));
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
                </div>

                <div className="space-y-2">
                    <Label>Адрес организации</Label>
                    <Input
                        value={addressOrg}
                        onChange={(e) => setAddressOrg(e.target.value)}
                        placeholder="Введите адрес организации"
                    />
                </div>
                <div className="space-y-2">
                    <Label>Опыт работы</Label>
                    <Input
                        value={experience}
                        onChange={(e) => setExperience(e.target.value)}
                        placeholder="Укажите опыт работы"
                    />
                </div>

                <div className="col-span-2 space-y-2">
                    <Label>Причина увольнения</Label>
                    <Textarea
                        value={dismissalReason}
                        onChange={(e) => setDismissalReason(e.target.value)}
                        placeholder="Укажите причину увольнения"
                    />
                </div>

                <div className="col-span-2 flex justify-end mt-4">
                    <Button onClick={handleAdd} type="button">
                        Добавить место работы
                    </Button>
                </div>
            </div>
        </div>
    );
} 