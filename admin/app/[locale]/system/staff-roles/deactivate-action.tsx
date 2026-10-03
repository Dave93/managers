"use client";
import { Button } from "@admin/components/ui/buttonOrigin";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@components/ui/popover";
import { PowerOffIcon } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { staffRolesApi, type StaffRole } from "@admin/lib/staff-roles";

// Не DeleteButton: здесь не удаление, а деактивация, и предупреждать надо не
// «вы уверены», а тем, сколько людей на этой роли стоит. Роль, под которой
// половина кухни, и роль, которую завели по ошибке, — разные решения.
export default function DeactivateAction({ role }: { role: StaffRole }) {
  const t = useTranslations("staffRoles");
  const queryClient = useQueryClient();
  const busy = (role.employees_count ?? 0) > 0;

  const mutation = useMutation({
    mutationFn: () => staffRolesApi.deactivate(role.id),
    onSuccess: (res: any) => {
      const kept = res?.employees_kept ?? 0;
      toast.success(
        kept > 0
          ? t("deactivatedWithPeople", { count: kept })
          : t("deactivated")
      );
      queryClient.invalidateQueries({ queryKey: ["staff_roles"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!role.active) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <PowerOffIcon className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <div className="grid gap-4">
          <div className="space-y-2">
            <h4 className="font-medium leading-none">{t("deactivate")}</h4>
            <p className="text-sm text-muted-foreground">
              {busy
                ? t("deactivateBusyWarning", {
                    count: role.employees_count ?? 0,
                  })
                : t("deactivateFreeHint")}
            </p>
          </div>
          <Button
            variant={busy ? "destructive" : "default"}
            size="sm"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {t("deactivateConfirm")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
