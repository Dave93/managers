"use client";
import { useToast } from "@admin/components/ui/use-toast";
import { Button } from "@components/ui/button";
import { useMemo, useRef, useState } from "react";
import { Loader2, CalendarIcon } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import { apiClient } from "@admin/utils/eden";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Select, SelectItem } from "@nextui-org/select";
import { Textarea } from "@components/ui/textarea";
import { Selection } from "@react-types/shared";
import { Chip } from "@nextui-org/chip";
import { Calendar } from "@admin/components/ui/calendar";
import { format } from "date-fns";
import { Popover, PopoverContent, PopoverTrigger } from "@components/ui/popover";
import { cn } from "@admin/lib/utils";


interface CandidateFormData {
    vacancyId: string;
    fullName: string;
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

    const closeForm = () => {
        form.reset();
        setOpen(false);
    };

    const onAddSuccess = (actionText: string) => {
        toast({
            title: "Success",
            description: `Candidate ${actionText}`,
            duration: 5000,
        });
        queryClient.invalidateQueries({ queryKey: ["candidates"] });
        closeForm();
    };

    const onError = (error: any) => {
        toast({
            title: "Error",
            description: error.message,
            variant: "destructive",
            duration: 5000,
        });
    };

    const createMutation = useMutation({
        mutationFn: async (newCandidate: CandidateFormData) => {
            try {
                const data = {
                    vacancyId: newCandidate.vacancyId,
                    fullName: newCandidate.fullName,
                    phoneNumber: newCandidate.phoneNumber,
                    email: newCandidate.email,
                    citizenship: newCandidate.citizenship,
                    residence: newCandidate.residence,
                    passportNumber: newCandidate.passportNumber,
                    passportSeries: newCandidate.passportSeries,
                    passportIdDate: newCandidate.passportIdPlace,
                    passportIdPlace: newCandidate.passportIdPlace,
                    source: newCandidate.source,
                    familyStatus: newCandidate.familyStatus,
                    children: newCandidate.children,
                    language: newCandidate.language
                }
                return await apiClient.api.candidates.post(data);
            } catch (error) {
                console.error('Error in createMutation:', error);
                throw error;
            }
        },
        onSuccess: () => onAddSuccess("Added"),
        onError,
    });

    const updateMutation = useMutation({
        mutationFn: async (newCandidate: {
            data: CandidateFormData;
            id: string;
        }) => {
            try {
                const data = {
                    vacancyId: newCandidate.data.vacancyId,
                    fullName: newCandidate.data.fullName,
                    phoneNumber: newCandidate.data.phoneNumber,
                    email: newCandidate.data.email,
                    citizenship: newCandidate.data.citizenship,
                    residence: newCandidate.data.residence,
                    passportNumber: newCandidate.data.passportNumber,
                    passportSeries: newCandidate.data.passportSeries,
                    passportIdDate: newCandidate.data.passportIdPlace,
                    passportIdPlace: newCandidate.data.passportIdPlace,
                    source: newCandidate.data.source,
                    familyStatus: newCandidate.data.familyStatus,
                    children: newCandidate.data.children,
                    language: newCandidate.data.language
                }
                return await apiClient.api.candidates({ id: newCandidate.id }).put(data);
            } catch (error) {
                console.error('Error in updateMutation:', error);
                throw error;
            }
        },
        onSuccess: () => onAddSuccess("Updated"),
        onError,
    });

    const form = useForm<CandidateFormData>({
        defaultValues: {
            vacancyId: "",
            fullName: "",
            phoneNumber: "",
            email: "",
            citizenship: "",
            residence: "",
            passportNumber: "",
            passportSeries: "",
            passportIdDate: "",
            passportIdPlace: "",
            source: "",
            familyStatus: "",
            children: 0,
            language: ""
        },
    });

    const handleSubmit = async (e: React.FormEvent) => {
        try {
            e.preventDefault();
            e.stopPropagation();
            await form.handleSubmit();
        }
        catch (error) {
            console.error('Error in handleSubmit', error)
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
                    <Label>First Name *</Label>
                    <form.Field name="vacancyId">
                        {(field) => (
                            < Input
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
                    <Label>Last Name *</Label>
                    <form.Field name="fullName">
                        {(field) => (
                            < Input
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

            {/* <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Middle Name</Label>
                    <Input
                        placeholder="Enter middle name"
                        {...form.getFieldProps("middleName")}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Birth Date *</Label>
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant={"outline"}
                                className={cn(
                                    "w-full justify-start text-left font-normal",
                                    !date && "text-muted-foreground"
                                )}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {date ? format(date, "PPP") : <span>Pick a date</span>}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0">
                            <Calendar
                                mode="single"
                                selected={date}
                                onSelect={(date) => {
                                    setDate(date);
                                    if (date) {
                                        form.setFieldValue("birthDate", format(date, "yyyy-MM-dd"));
                                    }
                                }}
                                initialFocus
                            />
                        </PopoverContent>
                    </Popover>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Phone *</Label>
                    <Input
                        required
                        type="tel"
                        placeholder="Enter phone number"
                        {...form.getFieldProps("phone")}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Email</Label>
                    <Input
                        type="email"
                        placeholder="Enter email"
                        {...form.getFieldProps("email")}
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label>Address *</Label>
                <Input
                    required
                    placeholder="Enter address"
                    {...form.getFieldProps("address")}
                />
            </div>

            <div className="space-y-2">
                <Label>Education *</Label>
                <Textarea
                    required
                    placeholder="Enter education details"
                    {...form.getFieldProps("education")}
                />
            </div>

            <div className="space-y-2">
                <Label>Work Experience *</Label>
                <Textarea
                    required
                    placeholder="Enter work experience"
                    {...form.getFieldProps("experience")}
                />
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Desired Position *</Label>
                    <Input
                        required
                        placeholder="Enter desired position"
                        {...form.getFieldProps("desiredPosition")}
                    />
                </div>
                <div className="space-y-2">
                    <Label>Desired Salary</Label>
                    <Input
                        type="number"
                        placeholder="Enter desired salary"
                        {...form.getFieldProps("desiredSalary")}
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label>Skills *</Label>
                <Textarea
                    required
                    placeholder="Enter skills"
                    {...form.getFieldProps("skills")}
                />
            </div>

            <div className="space-y-2">
                <Label>Languages *</Label>
                <Input
                    required
                    placeholder="Enter languages"
                    {...form.getFieldProps("languages")}
                />
            </div>

            <div className="space-y-2">
                <Label>Additional Information</Label>
                <Textarea
                    placeholder="Enter any additional information"
                    {...form.getFieldProps("additionalInfo")}
                />
            </div>

            <div className="space-y-2">
                <Label>Resume URL</Label>
                <Input
                    type="url"
                    placeholder="Enter resume URL"
                    {...form.getFieldProps("resumeUrl")}
                />
            </div>

            <div className="space-y-2">
                <Label>Status</Label>
                <Select
                    defaultSelectedKeys={["new"]}
                    className="w-full"
                    onChange={(e) => form.setFieldValue("status", e.target.value as CandidateFormData["status"])}
                >
                    <SelectItem key="new" value="new">New</SelectItem>
                    <SelectItem key="reviewing" value="reviewing">Reviewing</SelectItem>
                    <SelectItem key="interviewed" value="interviewed">Interviewed</SelectItem>
                    <SelectItem key="hired" value="hired">Hired</SelectItem>
                    <SelectItem key="rejected" value="rejected">Rejected</SelectItem>
                </Select>
            </div> */}

            <div className="flex justify-end space-x-4">
                <Button
                    type="button"
                    variant="outline"
                    onClick={closeForm}
                >
                    Cancel
                </Button>
                <Button
                    type="submit"
                    disabled={createMutation.isPending || updateMutation.isPending}
                >
                    {(createMutation.isPending || updateMutation.isPending) && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    {recordId ? "Update" : "Submit"}
                </Button>
            </div>
        </form>
    );
} 