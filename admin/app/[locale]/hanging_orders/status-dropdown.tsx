"use client";

import { useState } from "react";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@admin/components/ui/select";
import { Badge } from "@admin/components/ui/badge";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, CheckCircle } from "lucide-react";
import { cn } from "@admin/lib/utils";

interface StatusDropdownProps {
    recordId: string;
    currentStatus?: string | null;
    className?: string;
    size?: "sm" | "default" | "lg";
}

const statusOptions = [
{
    value: "pending",
    label: "В ожидании",
    variant: "secondary" as const,
    color: "bg-gray-100 text-gray-800 border-gray-200"
},
    { 
        value: "in_progress", 
        label: "В работе", 
        variant: "default" as const,
        color: "bg-blue-100 text-blue-800 border-blue-200"
    },
    { 
        value: "truth", 
        label: "Правда", 
        variant: "default" as const,
        color: "bg-green-100 text-green-800 border-green-200"
    },
    { 
        value: "lie", 
        label: "Ложь", 
        variant: "destructive" as const,
        color: "bg-red-100 text-red-800 border-red-200"
    },
    { 
        value: "no_info", 
        label: "Нет информации", 
        variant: "default" as const,
        color: "bg-gray-100 text-gray-800 border-gray-200"
    },
];

const getStatusOption = (status: string) => {
    return statusOptions.find(option => option.value === status) || statusOptions[0];
};

const getStatusBadgeVariant = (status: string) => {
    const option = getStatusOption(status);
    return option.variant;
};

export function StatusDropdown({
    recordId,
    currentStatus,
    className,
    size = "sm",
}: StatusDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const queryClient = useQueryClient();

    const updateStatusMutation = useMutation({
        mutationFn: async (newStatus: string) => {
            const { data } = await apiClient.api["hanging-orders"]({id: recordId}).status.patch({
                status: newStatus,
            });
            return data;
        },
        onSuccess: (data, newStatus) => {
            queryClient.invalidateQueries({ queryKey: ["hanging-orders"] });
            const statusLabel = getStatusOption(newStatus).label;
            toast.success(`Статус изменен на "${statusLabel}"`, {
                duration: 3000,
                icon: <CheckCircle className="h-4 w-4" />,
            });
        },
        onError: (error) => {
            console.error("Error updating status:", error);
            toast.error("Ошибка при изменении статуса");
        },
    });

    const handleStatusChange = (newStatus: string) => {
        if (newStatus !== currentStatus) {
            updateStatusMutation.mutate(newStatus);
        }
        setIsOpen(false);
    };

    const currentStatusOption = getStatusOption(currentStatus || "pending");
    const isSaving = updateStatusMutation.isPending;

    return (
        <div className={cn("relative", className)}>
            <Select
                value={currentStatus || "pending"}
                onValueChange={handleStatusChange}
                open={isOpen}
                onOpenChange={setIsOpen}
                disabled={isSaving}
            >
                <SelectTrigger 
                    className={cn(
                        "border-0 bg-transparent p-0 h-auto focus:ring-0 focus:ring-offset-0",
                        isSaving && "opacity-70"
                    )}
                >
                    <div className="flex items-center gap-2">
                        {isSaving ? (
                            <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                <span className="text-xs">Сохранение...</span>
                            </div>
                        ) : (
                            <Badge 
                                variant={getStatusBadgeVariant(currentStatus || "pending")}
                                className={cn(
                                    "cursor-pointer transition-all hover:opacity-80",
                                    size === "sm" && "text-xs px-2 py-1",
                                    size === "default" && "text-sm px-3 py-1",
                                    size === "lg" && "text-base px-4 py-2"
                                )}
                            >
                                {currentStatusOption.label}
                            </Badge>
                        )}
                    </div>
                </SelectTrigger>
                
                <SelectContent 
                    align="start" 
                    className="min-w-[180px]"
                    side="bottom"
                >
                    {statusOptions.map((option) => (
                        <SelectItem 
                            key={option.value} 
                            value={option.value}
                            className="cursor-pointer"
                        >
                            <div className="flex items-center gap-2">
                                <div 
                                    className={cn(
                                        "w-3 h-3 rounded-full border",
                                        option.color
                                    )}
                                />
                                <span>{option.label}</span>
                                {option.value === currentStatus && (
                                    <CheckCircle className="h-3 w-3 ml-auto text-green-600" />
                                )}
                            </div>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}