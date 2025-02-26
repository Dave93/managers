"use client";

import { Button } from "@components/ui/button";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { Select, SelectItem } from "@nextui-org/select";
import { useState, useRef } from "react";
import { Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@admin/components/ui/use-toast";
import { Chip } from "@nextui-org/react";

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

export default function EducationForm({ onAdd, onRemove, entries }: EducationFormProps) {
    const formRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();
    const [educationType, setEducationType] = useState("");
    const [university, setUniversity] = useState("");
    const [speciality, setSpeciality] = useState("");
    const [dateStart, setDateStart] = useState("");
    const [dateEnd, setDateEnd] = useState("");

    const handleAdd = () => {
        try {
            console.log('Adding education with data:', {
                educationType,
                university,
                speciality,
                dateStart,
                dateEnd
            });

            // Validate required fields
            if (!educationType || !university || !speciality || !dateStart || !dateEnd) {
                console.error('Validation failed: Missing required fields', {
                    educationType,
                    university,
                    speciality,
                    dateStart,
                    dateEnd
                });
                toast({
                    title: "Ошибка",
                    description: "Пожалуйста, заполните все поля",
                    variant: "destructive",
                });
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
                    description: "Дата окончания не может быть раньше даты начала",
                    variant: "destructive",
                });
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
            toast({
                title: "Успешно",
                description: "Запись об образовании добавлена",
            });

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
            toast({
                title: "Ошибка",
                description: "Произошла ошибка при добавлении образования",
                variant: "destructive",
            });
        }
    };

    return (
        <div className="space-y-4" ref={formRef}>
            <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Записи образования</h2>
            </div>

            {entries.length > 0 && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-md mb-4">
                    <p className="font-medium text-green-700">Добавлено записей: {entries.length}</p>
                    <ul className="list-disc pl-5 mt-2">
                        {entries.map((entry, index) => (
                            <li key={index} className="text-sm text-green-800 mb-1">
                                {entry.university} - {entry.speciality} ({entry.educationType})
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => onRemove(index)}
                                    className="ml-2 h-6 text-red-500 hover:text-red-700"
                                >
                                    <Trash2 className="h-3 w-3 mr-1" /> Удалить
                                </Button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="grid grid-cols-2 gap-4 p-4 rounded-lg border border-border bg-slate-50">
                <h3 className="col-span-2 font-semibold text-lg border-b pb-2 mb-2">Добавить новое образование</h3>

                <div className="space-y-2">
                    <Label>Дата начала *</Label>
                    <Input
                        type="date"
                        value={dateStart}
                        onChange={(e) => setDateStart(e.target.value)}
                        required
                        className="bg-white"
                    />
                </div>
                <div className="space-y-2">
                    <Label>Дата окончания *</Label>
                    <Input
                        type="date"
                        value={dateEnd}
                        onChange={(e) => setDateEnd(e.target.value)}
                        required
                        className="bg-white"
                    />
                </div>
                <div className="space-y-2">
                    <Label>Тип образования *</Label>
                    <Select
                        placeholder="Выберите тип"
                        selectedKeys={educationType ? [educationType] : []}
                        onSelectionChange={(keys) => {
                            const selected = Array.from(keys)[0] as string;
                            setEducationType(selected);
                        }}
                        className="max-w-full bg-white"
                        popoverProps={{
                            portalContainer: formRef.current!,
                            offset: 0,
                            containerPadding: 0,
                        }}
                    >
                        <SelectItem key="Высшее">Высшее</SelectItem>
                        <SelectItem key="Среднее">Среднее</SelectItem>
                        <SelectItem key="Профессиональное">Профессиональное</SelectItem>
                    </Select>
                </div>
                <div className="space-y-2">
                    <Label>Учебное заведение *</Label>
                    <Input
                        placeholder="Введите название"
                        value={university}
                        onChange={(e) => setUniversity(e.target.value)}
                        required
                        className="bg-white"
                    />
                </div>
                <div className="space-y-2 col-span-2">
                    <Label>Специальность *</Label>
                    <Input
                        placeholder="Введите специальность"
                        value={speciality}
                        onChange={(e) => setSpeciality(e.target.value)}
                        required
                        className=""
                    />
                </div>

                <div className="col-span-2 mt-4 flex justify-center">
                    <Button
                        onClick={handleAdd}
                        className="bg-primary  w-full py-6 text-lg"
                        size="lg"
                    >
                        + Добавить запись об образовании
                    </Button>
                </div>
            </div>
        </div>
    );
} 