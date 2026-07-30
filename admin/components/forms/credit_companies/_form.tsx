import { toast } from "sonner";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Switch } from "@components/ui/switch";
import { useMemo, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { Label } from "@components/ui/label";
import { Input } from "@components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createCompany as createCompanyApi,
  updateCompany as updateCompanyApi,
  getCompany as getCompanyApi,
  type CreditCompanyStatus,
} from "@admin/lib/credit-api";

type CreditCompanyFormValues = {
  name: string;
  inn: string;
  phone: string;
  status: CreditCompanyStatus;
  // Displayed/entered in сумы; converted to tiyins (*100) only in onSubmit.
  limit_total: number;
  limit_daily: number;
  limit_monthly: number;
  verified: boolean;
};

const DEFAULT_VALUES: CreditCompanyFormValues = {
  name: "",
  inn: "",
  phone: "",
  status: "pending_verification",
  limit_total: 0,
  limit_daily: 0,
  limit_monthly: 0,
  verified: false,
};

export default function CreditCompaniesForm({
  setOpen,
  recordId,
}: {
  setOpen: (open: boolean) => void;
  recordId?: string;
}) {
  const queryClient = useQueryClient();

  const onAddSuccess = (actionText: string) => {
    toast.success(`Кредитная компания ${actionText}`);
    queryClient.invalidateQueries({ queryKey: ["credit_companies"] });
    setOpen(false);
  };

  const onError = (error: any) => {
    toast.error(error.message);
  };

  // POST's body has no `verified` and requires status/limit_*; PUT's body is
  // all-optional plus `verified`. The two mutations build their own payload
  // from `value` rather than sharing one object — Eden's generated types
  // reject `verified` on .post().
  const createMutation = useMutation({
    mutationFn: (value: CreditCompanyFormValues) => {
      return createCompanyApi({
        name: value.name,
        inn: value.inn || undefined,
        phone: value.phone || undefined,
        status: value.status,
        limit_total: Math.round(value.limit_total * 100),
        limit_daily: Math.round(value.limit_daily * 100),
        limit_monthly: Math.round(value.limit_monthly * 100),
      });
    },
    onSuccess: () => onAddSuccess("добавлена"),
    onError,
  });

  const updateMutation = useMutation({
    mutationFn: (data: { value: CreditCompanyFormValues; id: string }) => {
      return updateCompanyApi(data.id, {
        name: data.value.name,
        inn: data.value.inn || undefined,
        phone: data.value.phone || undefined,
        status: data.value.status,
        limit_total: Math.round(data.value.limit_total * 100),
        limit_daily: Math.round(data.value.limit_daily * 100),
        limit_monthly: Math.round(data.value.limit_monthly * 100),
        verified: data.value.verified || undefined,
      });
    },
    onSuccess: () => onAddSuccess("обновлена"),
    onError,
  });

  // GET /credit/companies/:id returns { company, account, phones } — not a
  // bare company row like external-partners' single-record route. Reads
  // below go through `record.data.company`, including verified_at (drives
  // the verification-checkbox visibility just below).
  const { data: record, isLoading: isRecordLoading } = useQuery({
    queryKey: ["one_credit_company", recordId],
    queryFn: () => {
      if (recordId) {
        return getCompanyApi(recordId);
      } else {
        return null;
      }
    },
    enabled: !!recordId,
  });

  const company = record?.data?.company;
  const alreadyVerified = !!company?.verified_at;

  const form = useForm({
    defaultValues: DEFAULT_VALUES,
    onSubmit: async ({ value }) => {
      if (recordId) {
        updateMutation.mutate({ value, id: recordId });
      } else {
        createMutation.mutate(value);
      }
    },
  });

  const isLoading = useMemo(() => {
    return createMutation.isPending || updateMutation.isPending;
  }, [createMutation.isPending, updateMutation.isPending]);

  // Reset to defaults for creation.
  useEffect(() => {
    if (!recordId) {
      form.reset();
    }
  }, [recordId, form]);

  // Populate form once the record loads for editing.
  useEffect(() => {
    if (company && recordId) {
      form.reset({
        name: company.name ?? "",
        inn: company.inn ?? "",
        phone: company.phone ?? "",
        status: (company.status ?? "pending_verification") as CreditCompanyStatus,
        limit_total: (company.limit_total ?? 0) / 100,
        limit_daily: (company.limit_daily ?? 0) / 100,
        limit_monthly: (company.limit_monthly ?? 0) / 100,
        verified: false,
      });
    }
  }, [company, recordId, form]);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
        className="space-y-8"
      >
        <div className="space-y-2">
          <div>
            <Label>Название</Label>
          </div>
          <form.Field name="name">
            {(field) => (
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value ?? ""}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            )}
          </form.Field>
        </div>
        <div className="space-y-2">
          <div>
            <Label>ИНН</Label>
          </div>
          <form.Field name="inn">
            {(field) => (
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value ?? ""}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            )}
          </form.Field>
        </div>
        <div className="space-y-2">
          <div>
            <Label>Телефон (контактный)</Label>
          </div>
          <form.Field name="phone">
            {(field) => (
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value ?? ""}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            )}
          </form.Field>
        </div>
        <div className="space-y-2">
          <div>
            <Label>Статус</Label>
          </div>
          <form.Field name="status">
            {(field) => (
              <Select
                value={field.state.value}
                onValueChange={(value) => field.handleChange(value as CreditCompanyStatus)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Выберите статус" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Активна</SelectItem>
                  <SelectItem value="suspended">Приостановлена</SelectItem>
                  <SelectItem value="pending_verification">На проверке</SelectItem>
                </SelectContent>
              </Select>
            )}
          </form.Field>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <div>
              <Label>Лимит всего (сум)</Label>
            </div>
            <form.Field name="limit_total">
              {(field) => (
                <Input
                  type="number"
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) =>
                    field.handleChange(e.target.value === "" ? 0 : Number(e.target.value))
                  }
                />
              )}
            </form.Field>
          </div>
          <div className="space-y-2">
            <div>
              <Label>Лимит в день (сум)</Label>
            </div>
            <form.Field name="limit_daily">
              {(field) => (
                <Input
                  type="number"
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) =>
                    field.handleChange(e.target.value === "" ? 0 : Number(e.target.value))
                  }
                />
              )}
            </form.Field>
          </div>
          <div className="space-y-2">
            <div>
              <Label>Лимит в месяц (сум)</Label>
            </div>
            <form.Field name="limit_monthly">
              {(field) => (
                <Input
                  type="number"
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) =>
                    field.handleChange(e.target.value === "" ? 0 : Number(e.target.value))
                  }
                />
              )}
            </form.Field>
          </div>
        </div>
        {/* Only shown while editing a not-yet-verified company — verified_by/
            verified_at stamp once server-side; re-showing this after
            verification would just be a no-op toggle with no visible effect. */}
        {recordId && !alreadyVerified && (
          <div className="space-y-2">
            <div>
              <Label>Подтвердить верификацию</Label>
            </div>
            <form.Field name="verified">
              {(field) => (
                <Switch
                  checked={field.state.value ?? false}
                  onCheckedChange={field.handleChange}
                />
              )}
            </form.Field>
          </div>
        )}
        <Button type="submit" disabled={isLoading || (!!recordId && isRecordLoading)}>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Сохранить
        </Button>
      </form>
    </div>
  );
}
