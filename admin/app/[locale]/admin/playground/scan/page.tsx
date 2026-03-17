"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { apiClient } from "@admin/utils/eden";
import { Button } from "@admin/components/ui/button";
import { Input } from "@admin/components/ui/input";

type ValidationResult = {
  type: "success" | "error" | "warning";
  title: string;
  details?: string[];
};

export default function PlaygroundScanPage() {
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const scannerContainerId = "qr-reader";

  const handleQrData = useCallback(async (qrData: string) => {
    if (scannerRef.current?.isScanning) {
      await scannerRef.current.stop();
      setIsScanning(false);
    }

    if (!qrData.startsWith("PLAYGROUND:")) {
      setResult({
        type: "warning",
        title: "Это не билет детской площадки",
      });
      return;
    }

    try {
      const { data, status } = await apiClient.api.playground_tickets.validate.post({
        qr_data: qrData,
      });

      if (status === 200 && data && "ticket_id" in data) {
        setResult({
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
        const errorData = data as any;
        let title = "Ошибка валидации";
        if (errorData?.message === "Ticket already used") {
          title = "Билет уже использован";
          const usedAt = errorData.used_at
            ? new Date(errorData.used_at).toLocaleString("ru-RU")
            : "";
          setResult({
            type: "error",
            title,
            details: usedAt ? [`Использован: ${usedAt}`] : undefined,
          });
        } else if (errorData?.message === "Ticket expired") {
          setResult({ type: "error", title: "Билет просрочен" });
        } else if (errorData?.message === "Ticket not found") {
          setResult({ type: "error", title: "Билет не найден" });
        } else {
          setResult({ type: "error", title: errorData?.message || title });
        }
      }
    } catch (err) {
      setResult({
        type: "error",
        title: "Ошибка сети. Попробуйте ещё раз.",
      });
    }
  }, []);

  const startScanner = useCallback(async () => {
    setResult(null);
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
        title: "Не удалось запустить камеру. Используйте ручной ввод.",
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

  const handleManualSubmit = () => {
    if (manualInput.trim()) {
      const qrData = manualInput.trim().startsWith("PLAYGROUND:")
        ? manualInput.trim()
        : `PLAYGROUND:${manualInput.trim()}`;
      handleQrData(qrData);
    }
  };

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

      <div className="flex gap-2 mb-4">
        <Input
          placeholder="Или введите ID билета вручную"
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
        />
        <Button variant="outline" onClick={handleManualSubmit}>
          Проверить
        </Button>
      </div>

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
            setManualInput("");
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
