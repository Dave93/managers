import type { InventoryFolders } from "@backend/modules/inventory/types";

export type FolderProduct = { id: string; name: string; unit_name: string | null };
export type FolderNode = {
  id: string;
  name: string;
  children: FolderNode[];
  products: FolderProduct[];
  productIds: string[];
};

export const NO_GROUP_ID = "__none__";

export function buildFolderTree(f: InventoryFolders): FolderNode[] {
  const nodes = new Map<string, FolderNode>();
  for (const g of f.groups) nodes.set(g.id, { id: g.id, name: g.name, children: [], products: [], productIds: [] });
  const noGroup: FolderNode = { id: NO_GROUP_ID, name: "Без группы", children: [], products: [], productIds: [] };

  for (const p of f.products) {
    const node = p.parent_id ? nodes.get(p.parent_id) : undefined;
    (node ?? noGroup).products.push({ id: p.id, name: p.name, unit_name: p.unit_name });
  }

  const roots: FolderNode[] = [];
  for (const g of f.groups) {
    const node = nodes.get(g.id)!;
    const parent = g.parent_id ? nodes.get(g.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  // Снизу вверх: собрать productIds и выбросить ветки без товаров.
  const finalize = (n: FolderNode): boolean => {
    n.children = n.children.filter(finalize);
    n.productIds = [...n.products.map((p) => p.id), ...n.children.flatMap((c) => c.productIds)];
    return n.productIds.length > 0;
  };
  const out = roots.filter(finalize);
  finalize(noGroup);
  if (noGroup.productIds.length) out.push(noGroup);
  return out.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
