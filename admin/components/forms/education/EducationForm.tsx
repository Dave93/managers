"use client";

import { Button } from "@admin/components/ui/buttonOrigin";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@components/ui/select";
import { useState, useRef } from "react";
import { CalendarIcon, Trash2 } from "lucide-react";
import { Calendar } from "@admin/components/ui/calendar";
import { format } from "date-fns";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@components/ui/popover";
import { cn } from "@admin/lib/utils";
import { DropdownProps } from "react-day-picker";
import { CalendarOrigin } from "@admin/components/ui/calendarOrigin";
import { DropdownNavProps } from "react-day-picker";

export interface EducationEntry {
    dateStart: string;
    dateEnd: string;
    educationType: string;
    university: string;
    speciality: string;
}

interface EducationFormProps {
    onAdd: (education: EducationEntry) => void;
    onRemove: (index: number) => void;
    entries: EducationEntry[];
}

const handleCalendarChange = (_value: string | number, _e: React.ChangeEventHandler<HTMLSelectElement>) => {
    const _event = {
        target: {
            value: String(_value),
        },
    } as React.ChangeEvent<HTMLSelectElement>
    _e(_event)
}
export default function EducationForm({ onAdd, onRemove, entries }: EducationFormProps) {


    const formRef = useRef<HTMLDivElement>(null);
    const [educationType, setEducationType] = useState("");
    const [university, setUniversity] = useState("");
    const [speciality, setSpeciality] = useState("");
    const [dateStart, setDateStart] = useState("");
    const [dateEnd, setDateEnd] = useState("");

    const handleAdd = (e?: React.MouseEvent) => {
        try {
            // Prevent any form submission if this is triggered by an event
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            console.log('Adding education with data:', {
                educationType,
                university,
                speciality,
                dateStart,
                dateEnd
            });

            // Validate required fields
            const missingFields = [];
            if (!educationType) missingFields.push("Тип образования");
            if (!university) missingFields.push("Учебное заведение");
            if (!speciality) missingFields.push("Специальность");
            if (!dateStart) missingFields.push("Дата начала");
            if (!dateEnd) missingFields.push("Дата окончания");

            if (missingFields.length > 0) {
                console.error('Validation failed: Missing required fields', {
                    educationType,
                    university,
                    speciality,
                    dateStart,
                    dateEnd
                });
                toast.error(`Пожалуйста, заполните следующие поля: ${missingFields.join(", ")}`);
                return;
            }

            // Validate dates
            const startDate = new Date(dateStart);
            const endDate = new Date(dateEnd);

            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                console.error('Validation failed: Invalid dates', {
                    dateStart,
                    dateEnd,
                    startDate,
                    endDate
                });
                toast.error("Пожалуйста, введите корректные даты");
                return;
            }

            if (endDate < startDate) {
                console.error('Validation failed: End date before start date', {
                    startDate,
                    endDate
                });
                toast.error("Дата окончания не может быть раньше даты начала");
                return;
            }

            const formattedData = {
                dateStart: format(startDate, "yyyy-MM-dd"),
                dateEnd: format(endDate, "yyyy-MM-dd"),
                educationType,
                university,
                speciality
            };

            console.log('Adding formatted education data:', formattedData);

            // Вызов функции onAdd для добавления записи в родительский компонент
            onAdd(formattedData);

            // Показываем сообщение об успехе
            toast.success("Запись об образовании добавлена");

            // Reset form
            setEducationType("");
            setUniversity("");
            setSpeciality("");
            setDateStart("");
            setDateEnd("");
        } catch (error: any) {
            console.error('Error adding education:', {
                message: error?.message || 'Unknown error',
                stack: error?.stack || 'No stack trace',
                formData: {
                    educationType,
                    university,
                    speciality,
                    dateStart,
                    dateEnd
                }
            });
            toast.error("Произошла ошибка при добавлении образования");
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
                <h2 className="text-xl font-semibold">Записи образования</h2>
            </div>

            {entries.length > 0 && (
                <div className="p-3 rounded-md mb-4">
                    <p className="font-medium text-green-700">Добавлено записей: {entries.length}</p>
                    <ul className="list-disc pl-5 mt-2">
                        {entries.map((entry, index) => (
                            <li key={index} className="text-sm text-green-800 mb-1">
                                {entry.university} - {entry.speciality} ({entry.educationType})
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
                <h3 className="col-span-2 font-semibold text-lg border-b pb-2 mb-2">Добавить новое образование</h3>

                <div className="space-y-2">
                    <Label className="flex items-center">
                        Дата начала <span className="text-red-500 ml-1">*</span>
                    </Label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                type="button"
                                variant={"outline"}
                                className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !dateStart && "text-muted-foreground"
                                )}
                                aria-label="Select date"
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {dateStart ? format(dateStart, "PPP") : <span>Выберите дату</span>}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent container={formRef.current!} className="w-auto p-0">
                            <Calendar
                                mode="single"
                                selected={dateStart ? new Date(dateStart) : undefined}
                                onSelect={(date) => {
                                    if (date) {
                                        setDateStart(format(date, "yyyy-MM-dd"));
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
                        Дата окончания <span className="text-red-500 ml-1">*</span>
                    </Label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                type="button"
                                variant={"outline"}
                                className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !dateEnd && "text-muted-foreground"
                                )}
                                aria-label="Select date"
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {dateEnd ? format(dateEnd, "PPP") : <span>Выберите дату</span>}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent container={formRef.current!} className="w-auto p-0">
                            <Calendar
                                mode="single"
                                selected={dateEnd ? new Date(dateEnd) : undefined}
                                onSelect={(date) => {
                                    if (date) {
                                        setDateEnd(format(date, "yyyy-MM-dd"));
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
                        Тип образования <span className="text-red-500 ml-1">*</span>
                    </Label>
                    <Select
                        value={educationType}
                        onValueChange={(value) => setEducationType(value)}
                    >
                        <SelectTrigger className="w-full">
                            <SelectValue placeholder="Выберите тип" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Высшее">Высшее</SelectItem>
                            <SelectItem value="Среднее">Среднее</SelectItem>
                            <SelectItem value="Профессиональное">Профессиональное</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label className="flex items-center">
                        Учебное заведение <span className="text-red-500 ml-1">*</span>
                    </Label>
                    <Input
                        placeholder="Введите название"
                        value={university}
                        onChange={(e) => setUniversity(e.target.value)}
                        className=""
                    />
                </div>
                <div className="space-y-2 col-span-2">
                    <Label className="flex items-center">
                        Специальность <span className="text-red-500 ml-1">*</span>
                    </Label>
                    <Input
                        placeholder="Введите специальность"
                        value={speciality}
                        onChange={(e) => setSpeciality(e.target.value)}
                        className=""
                    />
                </div>

                <div className="col-span-2 mt-4 flex justify-center">
                    <Button
                        type="button"
                        onClick={(e) => {
                            if (e) {
                                e.preventDefault();
                                e.stopPropagation();
                            }
                            handleAdd(e);
                        }}
                        className="bg-primary w-full py-6 text-lg"
                        size="lg"
                    >
                        + Добавить запись об образовании
                    </Button>
                </div>
            </div>
        </div>
    );
} 