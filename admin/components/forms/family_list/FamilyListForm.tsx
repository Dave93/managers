"use client";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { useState, useRef } from "react";
import { CalendarIcon, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@admin/lib/utils";
import { useToast } from "@admin/components/ui/use-toast";
import { Popover, PopoverContent, PopoverTrigger } from "@components/ui/popover";
import { Calendar } from "@admin/components/ui/calendar";

export interface FamilyListEntry {
    familyListName: string;
    familyListBirthDate: string;
    familyListPhone: string;
    familyListRelation: string;
    familyListAddress: string;
    familyJob: string;
}

interface FamilyListFormProps {
    entries: FamilyListEntry[];
    onAdd: (entry: FamilyListEntry) => void;
    onRemove: (index: number) => void;
}

export default function FamilyListForm({ entries, onAdd, onRemove }: FamilyListFormProps) {
    const formRef = useRef<HTMLDivElement>(null);
    const { toast } = useToast();

    const [familyListName, setFamilyListName] = useState("");
    const [familyListBirthDate, setFamilyListBirthDate] = useState("");
    const [familyListPhone, setFamilyListPhone] = useState("");
    const [familyListRelation, setFamilyListRelation] = useState("");
    const [familyListAddress, setFamilyListAddress] = useState("");
    const [familyJob, setFamilyJob] = useState("");

    const handleAdd = (e?: React.MouseEvent) => {
        try {
            // Prevent any form submission if this is triggered by an event
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }

            console.log('Adding family member with data:', {
                familyListName,
                familyListBirthDate,
                familyListPhone,
                familyListRelation,
                familyListAddress,
                familyJob
            });

            // Validate required fields
            const missingFields = [];
            if (!familyListName) missingFields.push("ФИО родственника");
            if (!familyListRelation) missingFields.push("Родственные отношения");

            if (missingFields.length > 0) {
                console.error('Validation failed: Missing required fields', {
                    familyListName,
                    familyListRelation
                });
                toast({
                    title: "Ошибка",
                    description: `Пожалуйста, заполните следующие поля: ${missingFields.join(", ")}`,
                    variant: "destructive",
                });
                return;
            }

            // Validate birth date if provided
            let formattedBirthDate = "";
            if (familyListBirthDate) {
                const birthDate = new Date(familyListBirthDate);
                if (isNaN(birthDate.getTime())) {
                    console.error('Validation failed: Invalid birth date', {
                        familyListBirthDate
                    });
                    toast({
                        title: "Ошибка",
                        description: "Пожалуйста, введите корректную дату рождения",
                        variant: "destructive",
                    });
                    return;
                }
                formattedBirthDate = format(birthDate, "yyyy-MM-dd");
            }

            const formattedData: FamilyListEntry = {
                familyListName,
                familyListBirthDate: formattedBirthDate,
                familyListPhone,
                familyListRelation,
                familyListAddress,
                familyJob
            };

            console.log('Adding formatted family member data:', formattedData);

            // Вызов функции onAdd для добавления записи в родительский компонент
            onAdd(formattedData);

            // Показываем сообщение об успехе
            toast({
                title: "Успешно",
                description: "Родственник добавлен",
            });

            // Reset form
            setFamilyListName("");
            setFamilyListBirthDate("");
            setFamilyListPhone("");
            setFamilyListRelation("");
            setFamilyListAddress("");
            setFamilyJob("");
        } catch (error: any) {
            console.error('Error adding family member:', {
                message: error?.message || 'Unknown error',
                stack: error?.stack || 'No stack trace',
                formData: {
                    familyListName,
                    familyListBirthDate,
                    familyListPhone,
                    familyListRelation,
                    familyListAddress,
                    familyJob
                }
            });
            toast({
                title: "Ошибка",
                description: "Произошла ошибка при добавлении родственника",
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
                <h2 className="text-xl font-semibold">Записи о родственниках</h2>
            </div>

            {entries.length > 0 && (
                <div className="p-3 rounded-md mb-4">
                    <p className="font-medium text-green-700">Добавлено родственников: {entries.length}</p>
                    <ul className="list-disc pl-5 mt-2">
                        {entries.map((entry, index) => (
                            <li key={index} className="text-sm text-green-800 mb-1">
                                {entry.familyListName} - {entry.familyListRelation}
                                {entry.familyListBirthDate && ` (${format(new Date(entry.familyListBirthDate), "dd.MM.yyyy")})`}
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

            <div className="grid grid-cols-2 gap-4 p-4 rounded-lg border border-border">
                <h3 className="col-span-2 font-semibold text-lg border-b pb-2 mb-2">Добавить нового родственника</h3>

                <div className="space-y-2">
                    <Label className="flex items-center">
                        ФИО родственника <span className="text-red-500 ml-1">*</span>
                    </Label>
                    <Input
                        value={familyListName}
                        onChange={(e) => setFamilyListName(e.target.value)}
                        placeholder="Введите ФИО родственника"
                    />
                </div>
                <div className="space-y-2">
                    <Label className="flex items-center">
                        Родственные отношения <span className="text-red-500 ml-1">*</span>
                    </Label>
                    <Input
                        value={familyListRelation}
                        onChange={(e) => setFamilyListRelation(e.target.value)}
                        placeholder="Например: мать, отец, брат, сестра"
                    />
                </div>

                <div className="space-y-2">
                    <Label>Дата рождения</Label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant={"outline"}
                                className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !familyListBirthDate && "text-muted-foreground"
                                )}
                                aria-label="Select date"
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {familyListBirthDate ? format(new Date(familyListBirthDate), "PPP") : <span>Выберите дату</span>}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                            <Calendar
                                mode="single"
                                selected={familyListBirthDate ? new Date(familyListBirthDate) : undefined}
                                onSelect={(date) => {
                                    if (date) {
                                        setFamilyListBirthDate(format(date, "yyyy-MM-dd"));
                                    }
                                }}
                                initialFocus
                            />
                        </PopoverContent>
                    </Popover>
                </div>
                <div className="space-y-2">
                    <Label>Телефон</Label>
                    <Input
                        value={familyListPhone}
                        onChange={(e) => setFamilyListPhone(e.target.value)}
                        placeholder="Введите номер телефона"
                        type="tel"
                    />
                </div>

                <div className="space-y-2">
                    <Label>Адрес</Label>
                    <Input
                        value={familyListAddress}
                        onChange={(e) => setFamilyListAddress(e.target.value)}
                        placeholder="Введите адрес проживания"
                    />
                </div>
                <div className="space-y-2">
                    <Label>Место работы</Label>
                    <Input
                        value={familyJob}
                        onChange={(e) => setFamilyJob(e.target.value)}
                        placeholder="Введите место работы"
                    />
                </div>

                <div className="col-span-2 flex justify-end mt-4">
                    <Button onClick={handleAdd} type="button">
                        Добавить родственника
                    </Button>
                </div>
            </div>
        </div>
    );
} 