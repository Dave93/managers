"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/button";

type ValidationResult = {
  type: "success" | "error" | "warning";
  title: string;
  details?: string[];
};

export default function PlaygroundScanPage() {
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isProcessingRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const scannerContainerId = "qr-reader";

  const beep = useCallback((freq: number, durationMs: number) => {
    try {
      if (!audioCtxRef.current) {
        const Ctx = (window.AudioContext ||
          (window as any).webkitAudioContext) as typeof AudioContext;
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
      osc.start(now);
      osc.stop(now + durationMs / 1000);
    } catch {
      // ignore — audio is best-effort
    }
  }, []);

  const feedback = useCallback(
    (type: ValidationResult["type"]) => {
      const vibrate = (pattern: number | number[]) => {
        if (typeof navigator !== "undefined" && navigator.vibrate) {
          navigator.vibrate(pattern);
        }
      };
      if (type === "success") {
        vibrate(180);
        beep(880, 120);
        setTimeout(() => beep(1320, 140), 130);
      } else if (type === "error") {
        vibrate([90, 70, 90, 70, 120]);
        beep(220, 320);
      } else {
        vibrate([60, 40, 60]);
        beep(440, 160);
      }
    },
    [beep]
  );

  const showResult = useCallback(
    (r: ValidationResult) => {
      setResult(r);
      feedback(r.type);
    },
    [feedback]
  );

  const handleQrData = useCallback(
    async (qrData: string) => {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;

      if (scannerRef.current?.isScanning) {
        await scannerRef.current.stop();
        setIsScanning(false);
      }

      if (!qrData.startsWith("PLAYGROUND:")) {
        showResult({
          type: "warning",
          title: "Это не билет детской площадки",
        });
        return;
      }

      try {
        const { data, error, status } =
          await apiClient.api.playground_tickets.validate.post({
            qr_data: qrData,
          });

        if (status === 200 && data && "ticket_id" in data) {
          showResult({
            type: "success",
            title: "Билет действителен",
            details: [
              `Кол-во детей: ${(data as any).children_count}`,
              `Номер заказа: ${(data as any).order_number}`,
              `Сумма: ${Intl.NumberFormat("ru-RU").format((data as any).order_amount)} сум`,
              `Терминал: ${(data as any).terminal_name}`,
            ],
          });
        } else {
          const errorData = (error as any)?.value ?? (data as any);
          const message = errorData?.message;
          if (message === "Ticket already used") {
            const usedAt = errorData.used_at
              ? new Date(errorData.used_at).toLocaleString("ru-RU")
              : "";
            showResult({
              type: "error",
              title: "Билет уже использован",
              details: usedAt ? [`Использован: ${usedAt}`] : undefined,
            });
          } else if (message === "Ticket expired") {
            showResult({ type: "error", title: "Билет просрочен" });
          } else if (message === "Ticket not found") {
            showResult({ type: "error", title: "Билет не найден" });
          } else {
            showResult({
              type: "error",
              title: message || "Ошибка валидации",
            });
          }
        }
      } catch (err) {
        showResult({
          type: "error",
          title: "Ошибка сети. Попробуйте ещё раз.",
        });
      }
    },
    [showResult]
  );

  const startScanner = useCallback(async () => {
    setResult(null);
    isProcessingRef.current = false;
    // Prime AudioContext inside the user-gesture handler — iOS Safari blocks
    // creating/resuming it later from async callbacks otherwise.
    try {
      if (!audioCtxRef.current) {
        const Ctx = (window.AudioContext ||
          (window as any).webkitAudioContext) as typeof AudioContext;
        audioCtxRef.current = new Ctx();
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }
    } catch {
      // ignore — audio is best-effort
    }
    try {
      if (!scannerRef.current) {
        scannerRef.current = new Html5Qrcode(scannerContainerId);
      }
      await scannerRef.current.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => handleQrData(decodedText),
        () => {}
      );
      setIsScanning(true);
    } catch (err) {
      console.error("Camera error:", err);
      setResult({
        type: "warning",
        title: "Не удалось запустить камеру. Проверьте разрешения.",
      });
    }
  }, [handleQrData]);

  useEffect(() => {
    return () => {
      if (scannerRef.current?.isScanning) {
        scannerRef.current.stop();
      }
    };
  }, []);

  const bgColor =
    result?.type === "success"
      ? "bg-green-100 border-green-500 text-green-800"
      : result?.type === "error"
        ? "bg-red-100 border-red-500 text-red-800"
        : result?.type === "warning"
          ? "bg-yellow-100 border-yellow-500 text-yellow-800"
          : "";

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-3xl font-bold tracking-tight pb-4">
        Сканирование билета
      </h2>

      <div id={scannerContainerId} className="mb-4 rounded-lg overflow-hidden" />

      {!isScanning && (
        <Button onClick={startScanner} className="w-full mb-4">
          Запустить камеру
        </Button>
      )}

      {result && (
        <div className={`border-2 rounded-lg p-6 ${bgColor}`}>
          <h3 className="text-xl font-bold mb-2">{result.title}</h3>
          {result.details && (
            <ul className="space-y-1">
              {result.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result && (
        <Button
          onClick={() => {
            setResult(null);
            startScanner();
          }}
          className="w-full mt-4"
        >
          Сканировать ещё
        </Button>
      )}
    </div>
  );
}
