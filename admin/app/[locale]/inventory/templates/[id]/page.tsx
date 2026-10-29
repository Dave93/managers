"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";
import { Switch } from "@admin/components/ui/switch";
import { Link, useRouter } from "@admin/i18n/routing";
import { InventoryApiError, inventoryApi } from "@admin/lib/inventory-api";
import { buildFolderTree, type FolderNode } from "@admin/lib/inventory/folder-tree";

function Folder({
  node,
  selected,
  toggleMany,
  query,
}: {
  node: FolderNode;
  selected: Set<string>;
  toggleMany: (ids: string[], on: boolean) => void;
  query: string;
}) {
  const [open, setOpen] = useState(false);
  const q = query.trim().toLowerCase();
  const products = q ? node.products.filter((p) => p.name.toLowerCase().includes(q)) : node.products;
  const childMatches = (n: FolderNode): boolean =>
    !q || n.products.some((p) => p.name.toLowerCase().includes(q)) || n.children.some(childMatches);
  if (!childMatches(node)) return null;
  const chosen = node.productIds.filter((id) => selected.has(id)).length;
  const all = chosen === node.productIds.length;
  const expanded = open || !!q;
  return (
    <div className="pl-3">
      <div className="flex items-center gap-2 min-h-[36px]">
        <button type="button" onClick={() => setOpen(!open)} className="p-1" aria-label="toggle">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={all}
          ref={(el) => {
            if (el) el.indeterminate = chosen > 0 && !all;
          }}
          onChange={() => toggleMany(node.productIds, !all)}
        />
        <span className="font-medium">{node.name}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {chosen}/{node.productIds.length}
        </span>
      </div>
      {expanded && (
        <div className="pl-6">
          {node.children.map((c) => (
            <Folder key={c.id} node={c} selected={selected} toggleMany={toggleMany} query={query} />
          ))}
          {products.map((p) => (
            <label key={p.id} className="flex items-center gap-2 min-h-[32px] text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={selected.has(p.id)}
                onChange={(e) => toggleMany([p.id], e.target.checked)}
              />
              {p.name}
              {p.unit_name && <span className="text-xs text-muted-foreground">{p.unit_name}</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("inventory.templates");
  const tRoot = useTranslations("inventory");
  const router = useRouter();
  const qc = useQueryClient();

  const tpl = useQuery({ queryKey: ["inventory_template", id], queryFn: () => inventoryApi.templates.get(id) });
  const folders = useQuery({ queryKey: ["inventory_folders"], queryFn: inventoryApi.folders, staleTime: 5 * 60_000 });
  const sugg = useQuery({ queryKey: ["inventory_template_sugg", id], queryFn: () => inventoryApi.templates.suggestions(id) });

  const [name, setName] = useState("");
  const [active, setActive] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!tpl.data) return;
    setName(tpl.data.name);
    setActive(tpl.data.active);
    setSelected(new Set(tpl.data.product_ids));
  }, [tpl.data]);

  const tree = useMemo(() => (folders.data ? buildFolderTree(folders.data) : []), [folders.data]);

  const toggleMany = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      for (const pid of ids) {
        if (on) next.add(pid);
        else next.delete(pid);
      }
      return next;
    });

  const save = useMutation({
    mutationFn: async () => {
      await inventoryApi.templates.update(id, { name, active });
      await inventoryApi.templates.setItems(id, [...selected]);
    },
    onSuccess: () => {
      toast.success(t("saved"));
      void qc.invalidateQueries({ queryKey: ["inventory_template", id] });
      void qc.invalidateQueries({ queryKey: ["inventory_templates"] });
      void qc.invalidateQueries({ queryKey: ["inventory_template_sugg", id] });
    },
    onError: (e: Error) => toast.error(tRoot("errors.generic", { message: e.message })),
  });

  const remove = useMutation({
    mutationFn: () => inventoryApi.templates.remove(id),
    onSuccess: () => {
      toast.success(t("deleted"));
      router.push("/inventory/templates");
    },
    onError: (e: Error) =>
      toast.error(e instanceof InventoryApiError && e.status === 409 ? t("inUse") : tRoot("errors.generic", { message: e.message })),
  });

  if (!tpl.data) return <div className="p-4">…</div>;

  return (
    <div className="p-4 space-y-4">
      <Link href="/inventory/templates" className="text-sm underline">
        ← {t("back")}
      </Link>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <div className="text-sm">{t("name")}</div>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="w-80" />
        </div>
        <label className="flex items-center gap-2 pb-2">
          <Switch checked={active} onCheckedChange={setActive} />
          {t("active")}
        </label>
        <div className="text-sm text-muted-foreground pb-2">{tpl.data.organization_name}</div>
        <div className="flex-1" />
        <Button variant="ghost" onClick={() => remove.mutate()} disabled={remove.isPending}>
          {t("delete")}
        </Button>
        <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
          {t("save")}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center gap-3">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} className="max-w-sm" />
            <span className="text-sm tabular-nums">{t("selected", { count: selected.size })}</span>
          </div>
          <div className="max-h-[70vh] overflow-y-auto -ml-3">
            {tree.map((n) => (
              <Folder key={n.id} node={n} selected={selected} toggleMany={toggleMany} query={query} />
            ))}
          </div>
        </div>
        <div className="rounded-md border p-3 space-y-2">
          <div className="font-medium">{t("suggestions")}</div>
          {sugg.data && sugg.data.length === 0 && <div className="text-sm text-muted-foreground">{t("noSuggestions")}</div>}
          {(sugg.data ?? []).map((s) => (
            <div key={s.product_id} className="flex items-center justify-between gap-2 text-sm">
              <span>
                {s.product_name} <span className="text-muted-foreground">· {t("times", { count: s.times })}</span>
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={selected.has(s.product_id)}
                onClick={() => toggleMany([s.product_id], true)}
              >
                {t("addToTemplate")}
              </Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
