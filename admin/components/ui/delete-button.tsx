import { Button } from "@admin/components/ui/buttonOrigin";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import { DeleteIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";

export function DeleteButton({
  recordId,
  deleteRecord,
}: {
  recordId: string;
  deleteRecord: any;
}) {
  const t = useTranslations("common");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="destructive" size="sm">
          <Trash2Icon className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="grid gap-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none text-center">{t("delete")}</h4>
            <p className="text-sm text-muted-foreground text-center">
              {t("deleteConfirm")}
            </p>
          </div>
          <div className="space-x-3 mx-auto">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                deleteRecord({
                  where: {
                    id: recordId,
                  },
                });
              }}
            >
              {t("delete")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
