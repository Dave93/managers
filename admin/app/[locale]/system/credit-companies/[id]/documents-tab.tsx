"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DownloadIcon, Loader2, Trash2Icon } from "lucide-react";
import { Input } from "@components/ui/input";
import { Label } from "@components/ui/label";
import { Button } from "@admin/components/ui/buttonOrigin";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@components/ui/alert-dialog";
import {
  deleteDocument,
  documentDownloadUrl,
  listDocuments,
  uploadDocument,
  type CreditDocumentType,
} from "@admin/lib/credit-api";

const DOC_TYPE_LABELS: Record<CreditDocumentType, string> = {
  contract: "Договор",
  inn_cert: "ИНН",
  guarantee_letter: "Гарантийное письмо",
  other: "Другое",
};

// Mirrors the backend allowlist/cap in credit_admin/controller.ts
// (UPLOAD_EXTS / MAX_UPLOAD_BYTES) so a doomed upload is rejected client-side
// instead of round-tripping to a 400/422.
const ACCEPT_EXTS = ".pdf,.jpg,.jpeg,.png,.webp,.docx";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const ERROR_MESSAGES: Record<string, string> = {
  too_large: "Файл слишком большой (макс. 20MB)",
  bad_type: "Недопустимый тип файла",
  bad_date: "Некорректная дата",
  company_not_found: "Компания не найдена",
  save_failed: "Не удалось сохранить документ",
};

export default function DocumentsTab({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  // Bumped on successful upload to remount the file input — clearing `file`
  // alone leaves the native <input> still showing the old filename.
  const [fileInputKey, setFileInputKey] = useState(0);
  const [type, setType] = useState<CreditDocumentType>("contract");
  const [docNumber, setDocNumber] = useState("");
  const [docDate, setDocDate] = useState("");

  const queryKey = ["credit_company_documents", companyId];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data } = await listDocuments(companyId);
      return data;
    },
  });

  const documents = data?.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("no_file");
      if (file.size > MAX_UPLOAD_BYTES) throw new Error("too_large");
      const { data, error } = await uploadDocument(companyId, {
        file,
        type,
        doc_number: docNumber || undefined,
        doc_date: docDate || undefined,
      });
      if (error) throw new Error(error.value?.error ?? "unknown");
      return data;
    },
    onSuccess: () => {
      toast.success("Документ загружен");
      setFile(null);
      setFileInputKey((k) => k + 1);
      setDocNumber("");
      setDocDate("");
      invalidate();
    },
    onError: (err: any) => {
      if (err.message === "no_file") {
        toast.error("Выберите файл");
        return;
      }
      toast.error(ERROR_MESSAGES[err.message] ?? "Не удалось загрузить документ");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await deleteDocument(id);
      if (error) throw new Error("unknown");
      return data;
    },
    onSuccess: () => {
      toast.success("Документ удалён");
      invalidate();
    },
    onError: () => toast.error("Не удалось удалить документ"),
  });

  return (
    <div className="space-y-4 py-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Тип</TableHead>
              <TableHead>№</TableHead>
              <TableHead>Дата</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                  Загрузка...
                </TableCell>
              </TableRow>
            ) : documents.length ? (
              documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell>{DOC_TYPE_LABELS[doc.type]}</TableCell>
                  <TableCell>{doc.doc_number ?? "—"}</TableCell>
                  <TableCell>
                    {doc.doc_date ? new Date(doc.doc_date).toLocaleDateString("ru-RU") : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 justify-end">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(documentDownloadUrl(doc.id), "_blank")}
                      >
                        <DownloadIcon className="h-4 w-4 mr-1" /> Скачать
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="destructive" size="sm">
                            <Trash2Icon className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Удалить документ?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Это действие нельзя отменить. Файл будет удалён навсегда.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Отмена</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteMutation.mutate(doc.id)}
                              disabled={deleteMutation.isPending}
                            >
                              Удалить
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                  Нет документов
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          uploadMutation.mutate();
        }}
        className="flex items-end gap-2 flex-wrap"
      >
        <div className="space-y-1">
          <Label>Файл</Label>
          <Input
            key={fileInputKey}
            type="file"
            accept={ACCEPT_EXTS}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="space-y-1">
          <Label>Тип</Label>
          <Select value={type} onValueChange={(v) => setType(v as CreditDocumentType)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="contract">Договор</SelectItem>
              <SelectItem value="inn_cert">ИНН</SelectItem>
              <SelectItem value="guarantee_letter">Гарантийное письмо</SelectItem>
              <SelectItem value="other">Другое</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>№ документа</Label>
          <Input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Дата</Label>
          <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
        </div>
        <Button type="submit" disabled={uploadMutation.isPending || !file}>
          {uploadMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Загрузить
        </Button>
      </form>
    </div>
  );
}
