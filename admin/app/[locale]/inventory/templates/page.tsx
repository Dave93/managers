"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@admin/components/ui/dialog";
import { Input } from "@admin/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@admin/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { Link, useRouter } from "@admin/i18n/routing";
import { inventoryApi } from "@admin/lib/inventory-api";

const ALL = "__all__";

export default function TemplatesPage() {
  const t = useTranslations("inventory.templates");
  const tRoot = useTranslations("inventory");
  const router = useRouter();
  const [org, setOrg] = useState(ALL);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [newOrg, setNewOrg] = useState("");

  const orgs = useQuery({ queryKey: ["inventory_orgs"], queryFn: inventoryApi.organizations });
  const list = useQuery({
    queryKey: ["inventory_templates", org],
    queryFn: () => inventoryApi.templates.list(org === ALL ? undefined : org),
  });
  const create = useMutation({
    mutationFn: () => inventoryApi.templates.create({ organization_id: newOrg, name }),
    onSuccess: (r) => router.push(`/inventory/templates/${r.id}`),
    onError: (e: Error) => toast.error(tRoot("errors.generic", { message: e.message })),
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>{t("new")}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("new")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("name")} />
              <Select value={newOrg} onValueChange={setNewOrg}>
                <SelectTrigger>
                  <SelectValue placeholder={t("organization")} />
                </SelectTrigger>
                <SelectContent>
                  {(orgs.data ?? []).map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button disabled={!name.trim() || !newOrg || create.isPending} onClick={() => create.mutate()}>
                {t("save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <Select value={org} onValueChange={setOrg}>
        <SelectTrigger className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{tRoot("overview.all")}</SelectItem>
          {(orgs.data ?? []).map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("name")}</TableHead>
            <TableHead>{t("organization")}</TableHead>
            <TableHead>{t("items")}</TableHead>
            <TableHead>{t("active")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(list.data ?? []).map((tpl) => (
            <TableRow key={tpl.id}>
              <TableCell>
                <Link className="underline" href={`/inventory/templates/${tpl.id}`}>
                  {tpl.name}
                </Link>
              </TableCell>
              <TableCell>{tpl.organization_name ?? "—"}</TableCell>
              <TableCell className="tabular-nums">{tpl.items_count}</TableCell>
              <TableCell>{tpl.active ? "✓" : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
