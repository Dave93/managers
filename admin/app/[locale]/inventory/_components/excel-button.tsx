"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@admin/components/ui/button";
import { downloadXlsx, type Sheet } from "@admin/lib/inventory/excel";

/** «Скачать Excel»: файл из данных, уже загруженных на экран. file() зовём по нажатию — берёт текущий режим и фильтр. */
export function ExcelButton({ label, file }: { label: string; file: () => { name: string; sheet: Sheet } }) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const { name, sheet } = file();
      await downloadXlsx(name, sheet);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size="sm" variant="outline" disabled={busy} onClick={download}>
      <Download className="mr-1 h-4 w-4" />
      {label}
    </Button>
  );
}
