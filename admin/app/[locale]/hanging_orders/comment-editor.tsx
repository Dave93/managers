"use client";

import { useState, useEffect, useCallback } from "react";
import { Textarea } from "@admin/components/ui/textarea";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Popover, PopoverContent, PopoverTrigger } from "@admin/components/ui/popover";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, MessageSquare, Edit3, X } from "lucide-react";
import { cn } from "@admin/lib/utils";

interface CommentEditorProps {
    recordId: string;
    initialComment?: string | null;
    className?: string;
}

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);

    return debouncedValue;
}

export function CommentEditor({
    recordId,
    initialComment,
    className,
}: CommentEditorProps) {
    const [comment, setComment] = useState(initialComment || "");
    const [lastSavedComment, setLastSavedComment] = useState(initialComment || "");
    const [isOpen, setIsOpen] = useState(false);
    const debouncedComment = useDebounce(comment, 1000); // 1 секунда задержки
    
    // Синхронизируем состояние при изменении initialComment (при обновлении данных из таблицы)
    useEffect(() => {
        setComment(initialComment || "");
        setLastSavedComment(initialComment || "");
    }, [initialComment]);
    
    const queryClient = useQueryClient();

    const updateCommentMutation = useMutation({
        mutationFn: async (newComment: string) => {
            const { data } = await apiClient.api["hanging-orders"]({id: recordId}).status.patch({
                comment: newComment,
            });
            return data;
        },
        onSuccess: (data, savedComment) => {
            setLastSavedComment(savedComment);
            queryClient.invalidateQueries({ queryKey: ["hanging-orders"] });
            toast.success("Комментарий сохранен", {
                duration: 2000,
            });
        },
        onError: (error) => {
            console.error("Error updating comment:", error);
            toast.error("Ошибка при сохранении комментария");
            // Возвращаем предыдущее значение при ошибке
            setComment(lastSavedComment);
        },
    });

    // Автоматическое сохранение при изменении debounced значения
    useEffect(() => {
        // Сохраняем только если:
        // 1. Popover открыт
        // 2. Есть изменения относительно последнего сохраненного значения  
        // 3. Это не начальная загрузка (debouncedComment изменился от initialComment)
        if (isOpen && 
            debouncedComment !== lastSavedComment && 
            debouncedComment !== (initialComment || '')) {
            
            console.log('Auto-saving comment:', {
                debouncedComment,
                lastSavedComment, 
                initialComment,
                isOpen
            });
            
            updateCommentMutation.mutate(debouncedComment.trim());
        }
    }, [debouncedComment, lastSavedComment, isOpen, initialComment]);

    const handleCommentChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setComment(e.target.value);
    }, []);

    const handleOpenChange = (open: boolean) => {
        setIsOpen(open);
        if (!open && comment !== lastSavedComment) {
            // Сохраняем при закрытии если есть изменения
            // Разрешаем сохранение пустого комментария (для удаления)
            updateCommentMutation.mutate(comment.trim());
        }
    };

    const isModified = comment !== lastSavedComment;
    const isSaving = updateCommentMutation.isPending;

    // Отображение в таблице - компактный вид
    const displayText = lastSavedComment || "Нет комментария";
    const truncatedText = displayText.length > 50 ? `${displayText.substring(0, 50)}...` : displayText;

    return (
        <div className={cn("", className)}>
            <Popover open={isOpen} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button
                        variant="ghost"
                        className={cn(
                            "h-auto p-2 justify-start text-left font-normal w-full",
                            !lastSavedComment && "text-muted-foreground"
                        )}
                    >
                        <div className="flex items-center justify-between w-full">
                            <span className="flex-1 truncate">
                                {truncatedText}
                            </span>
                            <div className="flex items-center ml-2 flex-shrink-0">
                                {isSaving ? (
                                    <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                                ) : isModified && isOpen ? (
                                    <div className="h-2 w-2 rounded-full bg-orange-400 animate-pulse" />
                                ) : (
                                    <Edit3 className="h-3 w-3 text-muted-foreground" />
                                )}
                            </div>
                        </div>
                    </Button>
                </PopoverTrigger>
                
                <PopoverContent className="w-80" align="start">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h4 className="font-medium text-sm">Комментарий к заказу</h4>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                                onClick={() => setIsOpen(false)}
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        </div>
                        
                        <div className="relative">
                            <Textarea
                                value={comment}
                                onChange={handleCommentChange}
                                placeholder="Добавьте комментарий к обработке заказа..."
                                className={cn(
                                    "min-h-[100px] resize-none pr-8",
                                    isModified && !isSaving && "border-orange-300 bg-orange-50/50",
                                    isSaving && "border-blue-300 bg-blue-50/50"
                                )}
                                rows={4}
                                autoFocus
                            />
                            
                            {/* Индикатор состояния */}
                            <div className="absolute right-2 top-2 flex items-center">
                                {isSaving ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                                ) : isModified ? (
                                    <div className="h-2 w-2 rounded-full bg-orange-400 animate-pulse" />
                                ) : (
                                    <MessageSquare className="h-4 w-4 text-green-500" />
                                )}
                            </div>
                        </div>
                        
                        {/* Статус сохранения */}
                        <div className="flex items-center justify-between">
                            <div className="text-xs text-muted-foreground">
                                {isSaving ? (
                                    <span className="text-blue-600">Сохранение...</span>
                                ) : isModified ? (
                                    <span className="text-orange-600">Несохраненные изменения</span>
                                ) : (
                                    <span className="text-green-600">Автосохранение включено</span>
                                )}
                            </div>
                            
                            <div className="text-xs text-muted-foreground">
                                {comment.length}/500
                            </div>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}