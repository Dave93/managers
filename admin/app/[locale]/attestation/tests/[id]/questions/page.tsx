"use client";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/buttonOrigin";
import { Input } from "@components/ui/input";
import { Switch } from "@components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

export default function QuestionsEditorPage() {
  const params = useParams();
  const testId = params.id as string;
  const t = useTranslations("attestation");
  const qc = useQueryClient();
  const key = ["attestation_questions", testId];

  const { data } = useQuery({
    queryKey: key,
    queryFn: () => apiClient.api.attestation.tests({ id: testId }).questions.get(),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const onError = (e: any) => toast.error(e.message);

  const [newQ, setNewQ] = useState("");
  const addQuestion = useMutation({
    mutationFn: () =>
      apiClient.api.attestation.questions.post({
        data: { test_id: testId, text: newQ, type: "single" },
      }),
    onSuccess: () => {
      setNewQ("");
      invalidate();
    },
    onError,
  });
  const delQuestion = useMutation({
    mutationFn: (id: string) =>
      apiClient.api.attestation.questions({ id }).delete({}),
    onSuccess: invalidate,
  });
  const editQuestion = useMutation({
    mutationFn: (p: { id: string; text?: string; type?: "single" | "multi" }) =>
      apiClient.api.attestation.questions({ id: p.id }).put({
        data: { text: p.text, type: p.type },
      }),
    onSuccess: invalidate,
  });
  const addOption = useMutation({
    mutationFn: (question_id: string) =>
      apiClient.api.attestation.options.post({
        data: { question_id, text: t("questions.optionDefault"), is_correct: false },
      }),
    onSuccess: invalidate,
  });
  const toggleCorrect = useMutation({
    mutationFn: (p: { id: string; is_correct: boolean }) =>
      apiClient.api.attestation.options({ id: p.id }).put({
        data: { is_correct: p.is_correct },
      }),
    onSuccess: invalidate,
  });
  const editOptionText = useMutation({
    mutationFn: (p: { id: string; text: string }) =>
      apiClient.api.attestation.options({ id: p.id }).put({ data: { text: p.text } }),
    onSuccess: invalidate,
  });
  const delOption = useMutation({
    mutationFn: (id: string) =>
      apiClient.api.attestation.options({ id }).delete({}),
    onSuccess: invalidate,
  });

  const questions = (data as any)?.data ?? [];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">{t("questions.title")}</h2>

      <div className="flex gap-2">
        <Input
          placeholder={t("questions.newQuestion")}
          value={newQ}
          onChange={(e) => setNewQ(e.target.value)}
        />
        <Button onClick={() => addQuestion.mutate()} disabled={!newQ}>
          <Plus className="h-4 w-4 mr-1" /> {t("questions.addQuestion")}
        </Button>
      </div>

      {questions.map((q: any) => (
        <div key={q.id} className="border rounded-md p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Input
              defaultValue={q.text}
              onBlur={(e) => editQuestion.mutate({ id: q.id, text: e.target.value })}
            />
            <select
              className="border rounded h-9 px-2 bg-background"
              defaultValue={q.type}
              onChange={(e) =>
                editQuestion.mutate({ id: q.id, type: e.target.value as any })
              }
            >
              <option value="single">{t("questions.single")}</option>
              <option value="multi">{t("questions.multi")}</option>
            </select>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => delQuestion.mutate(q.id)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-2 pl-4">
            {q.options.map((o: any) => (
              <div key={o.id} className="flex items-center gap-2">
                <Switch
                  checked={o.is_correct}
                  onCheckedChange={(v) =>
                    toggleCorrect.mutate({ id: o.id, is_correct: v })
                  }
                />
                <Input
                  defaultValue={o.text}
                  onBlur={(e) =>
                    editOptionText.mutate({ id: o.id, text: e.target.value })
                  }
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => delOption.mutate(o.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => addOption.mutate(q.id)}
            >
              <Plus className="h-4 w-4 mr-1" /> {t("questions.addOption")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
