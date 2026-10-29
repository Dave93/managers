import { Button } from "@admin/components/ui/buttonOrigin";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@admin/components/ui/sheet";
import { Plus, Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import VacancyForm from "./_form";

export default function VacancyFormSheet({
    recordId,
    trigger,
}: {
    recordId?: string;
    trigger?: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);
    const t = useTranslations("forms.vacancy");
    const tc = useTranslations("forms.common");

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
                {trigger || (
                    <Button>
                        {recordId ? (
                            <>
                                <Pencil className="mr-2 h-4 w-4" />
                                {tc("edit")}
                            </>
                        ) : (
                            <>
                                <Plus className="mr-2 h-4 w-4" />
                                {tc("create")}
                            </>
                        )}
                    </Button>
                )}
            </SheetTrigger>
            <SheetContent className="sm:max-w-2xl overflow-y-auto">
                <SheetHeader className="mb-5">
                    <SheetTitle>
                        {recordId ? t("titleEdit") : t("titleCreate")}
                    </SheetTitle>
                    <SheetDescription>
                        {recordId ? t("descriptionEdit") : t("descriptionCreate")}
                    </SheetDescription>
                </SheetHeader>
                <div className="space-y-6">
                    <VacancyForm setOpen={setOpen} recordId={recordId} />
                </div>
            </SheetContent>
        </Sheet>
    );
}
