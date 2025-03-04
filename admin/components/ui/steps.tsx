import * as React from "react";
import { cn } from "@admin/lib/utils";


interface Step {
    title: string;
    description?: string;
}

interface StepsProps {
    steps: Step[];
    currentStep: number;
    onStepClick?: (step: number) => void;
    className?: string;
}

export function Steps({ steps, currentStep, onStepClick, className }: StepsProps) {
    return (
        <div className={cn("space-y-4", className)}>
            <div className="flex items-center justify-between">
                {steps.map((step, index) => (
                    <React.Fragment key={step.title}>
                        <div
                            className={cn(
                                "flex flex-col items-center cursor-pointer",
                                index <= currentStep ? "text-primary" : "text-muted-foreground"
                            )}
                            onClick={() => onStepClick?.(index)}
                        >
                            <div
                                className={cn(
                                    "w-8 h-8 rounded-full flex items-center justify-center border-2",
                                    index <= currentStep
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-muted"
                                )}
                            >
                                {index + 1}
                            </div>
                            <div className="mt-2 text-sm font-medium">{step.title}</div>
                            {step.description && (
                                <div className="text-xs text-muted-foreground">
                                    {step.description}
                                </div>
                            )}
                        </div>
                        {index < steps.length - 1 && (
                            <div
                                className={cn(
                                    "flex-1 h-[2px] mx-4",
                                    index < currentStep ? "bg-primary" : "bg-muted"
                                )}
                            />
                        )}
                    </React.Fragment>
                ))}
            </div>
        </div>
    );
} 