"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
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
import { useCanAccess } from "@admin/components/use-can-access";
import {
  deleteDocument,
  documentDownloadUrl,
  listDocuments,
  uploadDocument,
  type CreditDocumentType,
} from "@admin/lib/credit-api";

const DOC_TYPES: CreditDocumentType[] = ["contract", "inn_cert", "guarantee_letter", "other"];

// Mirrors the backend allowlist/cap in credit_admin/controller.ts
// (UPLOAD_EXTS / MAX_UPLOAD_BYTES) so a doomed upload is rejected client-side
// instead of round-tripping to a 400/422.
const ACCEPT_EXTS = ".pdf,.jpg,.jpeg,.png,.webp,.docx";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

// Error codes that have a translated message under `errors.<code>`.
const KNOWN_ERRORS = ["too_large", "bad_type", "bad_date", "company_not_found", "save_failed"];

export default function DocumentsTab({ companyId }: { companyId: string }) {
  const t = useTranslations("systemPages.creditCompanies.documents");
  const tc = useTranslations("forms.common");
  const queryClient = useQueryClient();
  const canEdit = useCanAccess("credit.edit");
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
      toast.success(t("uploaded"));
      setFile(null);
      setFileInputKey((k) => k + 1);
      setDocNumber("");
      setDocDate("");
      invalidate();
    },
    onError: (err: any) => {
      if (err.message === "no_file") {
        toast.error(t("selectFile"));
        return;
      }
      toast.error(
        KNOWN_ERRORS.includes(err.message) ? t(`errors.${err.message}`) : t("uploadFailed")
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await deleteDocument(id);
      if (error) throw new Error("unknown");
      return data;
    },
    onSuccess: () => {
      toast.success(t("deleted"));
      invalidate();
    },
    onError: () => toast.error(t("deleteFailed")),
  });

  return (
    <div className="space-y-4 py-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tc("type")}</TableHead>
              <TableHead>№</TableHead>
              <TableHead>{t("date")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                  {tc("loading")}
                </TableCell>
              </TableRow>
            ) : documents.length ? (
              documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell>{t(`types.${doc.type}`)}</TableCell>
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
                        <DownloadIcon className="h-4 w-4 mr-1" /> {t("download")}
                      </Button>
                      {canEdit && (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm">
                              <Trash2Icon className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>{t("deleteTitle")}</AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("deleteDescription")}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => deleteMutation.mutate(doc.id)}
                                disabled={deleteMutation.isPending}
                              >
                                {tc("delete")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={4} className="h-16 text-center text-muted-foreground">
                  {t("empty")}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            uploadMutation.mutate();
          }}
          className="flex items-end gap-2 flex-wrap"
        >
          <div className="space-y-1">
            <Label>{t("file")}</Label>
            <Input
              key={fileInputKey}
              type="file"
              accept={ACCEPT_EXTS}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="space-y-1">
            <Label>{tc("type")}</Label>
            <Select value={type} onValueChange={(v) => setType(v as CreditDocumentType)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((dt) => (
                  <SelectItem key={dt} value={dt}>
                    {t(`types.${dt}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("docNumber")}</Label>
            <Input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>{t("date")}</Label>
            <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
          </div>
          <Button type="submit" disabled={uploadMutation.isPending || !file}>
            {uploadMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t("upload")}
          </Button>
        </form>
      )}
    </div>
  );
}
