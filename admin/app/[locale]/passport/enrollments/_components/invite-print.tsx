"use client";

// The printable invite — the only thing this whole section produces that
// leaves the screen and reaches a person who has never seen the system.
//
// Design constraints that drove the layout:
//  * One A5 portrait page. A5 because it is half a sheet: two invites per A4,
//    and it fits a name badge pocket / a clipboard at the pass.
//  * The QR block is 50 mm and carries its OWN 4-module quiet zone
//    (`marginSize={4}`), which is what the spec requires and what a decoder
//    actually looks for. The payload is ~90 bytes at level Q, i.e. a 45–49
//    module grid, so the printed data area still lands at ~42 mm — a phone
//    locks onto that from about an arm's length, and it is still far above the
//    ~25 mm where scanning from paper starts to get fussy. It was 60 mm (~51 mm
//    of data) until the sheet was measured against the A5 page and came out at
//    233 mm — 23 mm too tall, i.e. it printed on TWO pages, which defeats the
//    entire point of the format. The 10 mm came off the code because that was
//    the largest single block and it had the most slack; the type sizes did
//    not move, because a trainee reading instructions off paper is the other
//    thing this sheet has to get right. NOTHING dark may touch the
//    code: an earlier draft framed it in a black hairline 3 mm out, which eats
//    into the quiet zone and is the classic "scans on screen, fails after a
//    fold and a photocopy" defect. The frame is gone; the white margin is the
//    frame.
//  * Black on white, no shadow, no colour. It has to survive the branch's
//    laser printer and a photocopy of a photocopy.
//  * Both languages get the SAME type size. The trainee reads exactly one of
//    them, so neither can be the small print.
//
// PRINT ISOLATION. This renders through a portal straight onto <body>, so
// `body > *:not(.passport-invite-print) { display: none }` hides the admin
// sidebar, the section nav and the toasts — none of which this task owns and
// none of which it may edit. That is also why this is NOT a Radix Dialog:
// Radix mounts its own portal wrapper on <body>, which the same rule would
// have to whitelist, and its overlay would print as a grey wash.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { Copy, Info, Printer, X } from "lucide-react";

import { Button } from "@components/ui/buttonOrigin";
import { BOT_ENV_VAR, inviteUrl } from "./invite-link";
import { fmtLongDate, parseTimestamp } from "./use-enrollments";

export interface InviteToPrint {
  inviteId: string;
  expiresAt: string;
  traineeName: string;
  position: string | null;
  programRu: string | null;
  programUz: string | null;
  branch: string;
}

// Uzbek-Latin months, hand-tabulated: Intl's uz-Latn month names are not
// reliably present in every runtime this admin is opened from, and a printed
// date that silently falls back to English is exactly the kind of small
// failure nobody reports.
const UZ_MONTHS = [
  "yanvar",
  "fevral",
  "mart",
  "aprel",
  "may",
  "iyun",
  "iyul",
  "avgust",
  "sentabr",
  "oktabr",
  "noyabr",
  "dekabr",
];

function fmtUzDate(value: string | number | null | undefined): string {
  const ms = typeof value === "number" ? value : parseTimestamp(value);
  if (Number.isNaN(ms)) return "—";
  const d = new Date(ms);
  return `${d.getDate()}-${UZ_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const PRINT_CSS = `
.passport-invite-print { color-scheme: light; }
.passport-invite-print .invite-page {
  width: 148mm;
  /* NOT 210mm. Sizing the block to exactly the paper leaves zero rounding
     slack under the A5 zero-margin @page rule below, and a sub-pixel overflow
     is all it takes for a browser to emit a blank second page. 200mm keeps the
     layout tall enough for the mt-auto footer while staying clear of the edge.
     (No backticks in this comment: the whole block is a JS template literal.) */
  min-height: 200mm;
  background: #fff;
  color: #000;
}
@media print {
  @page { size: A5 portrait; margin: 0; }
  html, body { background: #fff !important; }
  body > *:not(.passport-invite-print) { display: none !important; }
  .passport-invite-print {
    position: static !important;
    inset: auto !important;
    display: block !important;
    padding: 0 !important;
    overflow: visible !important;
    background: #fff !important;
  }
  .passport-invite-print .invite-screen-only { display: none !important; }
  .passport-invite-print .invite-page {
    margin: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    page-break-after: avoid;
    break-after: avoid;
    break-inside: avoid;
  }
  .passport-invite-print * {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`;

function Steps({
  title,
  steps,
  warning,
}: {
  title: string;
  steps: string[];
  warning: string;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-[1.5mm] text-[9.5pt] font-bold leading-tight">{title}</p>
      <ol className="m-0 list-none space-y-[1.2mm] p-0">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-[2mm] text-[9pt] leading-[1.35]">
            <span className="w-[4mm] shrink-0 font-bold tabular-nums">
              {i + 1}.
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <p className="mt-[1.5mm] text-[8pt] leading-[1.3]">{warning}</p>
    </div>
  );
}

export function InvitePrintView({
  invite,
  onClose,
}: {
  invite: InviteToPrint;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Escape closes; the overlay is hand-rolled, so it has to do this itself.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const url = useMemo(() => inviteUrl(invite.inviteId), [invite.inviteId]);
  const expired = parseTimestamp(invite.expiresAt) < Date.now();

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} скопирован`);
    } catch {
      toast.error("Браузер не дал скопировать — выделите текст вручную");
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div className="passport-invite-print fixed inset-0 z-[80] overflow-y-auto bg-neutral-800/70 p-6 print:p-0">
      <style>{PRINT_CSS}</style>

      {/* ------------------------- screen-only toolbar ------------------------ */}
      <div className="invite-screen-only mx-auto mb-4 flex w-[148mm] max-w-full flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => window.print()} disabled={!url}>
            <Printer className="mr-1.5 size-3.5" /> Печать
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              url
                ? copy(url, "Ссылка")
                : copy(invite.inviteId, "Идентификатор инвайта")
            }
          >
            <Copy className="mr-1.5 size-3.5" />
            {url ? "Скопировать ссылку" : "Скопировать invite_id"}
          </Button>
        </div>
        <Button size="sm" variant="ghost" className="text-white" onClick={onClose}>
          <X className="mr-1.5 size-3.5" /> Закрыть
        </Button>
      </div>

      {!url && (
        <div className="invite-screen-only mx-auto mb-4 flex w-[148mm] max-w-full items-start gap-2 rounded-md border border-red-300 bg-red-50 px-3 py-2.5 text-[12.5px] leading-snug text-red-900">
          <Info className="mt-0.5 size-4 shrink-0" />
          <span>
            <b>Печать выключена: бот паспорта не настроен.</b> Ссылку для QR
            собрать не из чего — в сборке админки не задана переменная{" "}
            <code className="rounded bg-red-100 px-1 py-px font-mono text-[11px]">
              {BOT_ENV_VAR}
            </code>{" "}
            — имя бота паспорта, сейчас это{" "}
            <code className="font-mono text-[11px]">pasport_stajer_bot</code>.
            Стажировка уже создана, инвайт выпущен — распечатать его можно будет
            после того, как переменную зададут в{" "}
            <code className="font-mono text-[11px]">admin/.env</code> и админку
            пересоберут. Печатать QR «на всякий случай» нельзя: он не откроется
            ни у кого.
          </span>
        </div>
      )}

      {expired && (
        <div className="invite-screen-only mx-auto mb-4 w-[148mm] max-w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] leading-snug text-amber-900">
          Срок действия этого кода уже истёк. Выпустите новый через «Выдать
          новый QR».
        </div>
      )}

      {/* ----------------------------- the page ----------------------------- */}
      <div className="invite-page mx-auto flex max-w-full flex-col rounded-sm px-[12mm] py-[7mm] shadow-2xl print:shadow-none">
        {/* header rule */}
        <div className="flex items-baseline justify-between border-b-2 border-black pb-[2mm]">
          <span className="text-[8pt] font-bold uppercase tracking-[0.18em]">
            Паспорт стажёра
          </span>
          <span className="text-[8pt] uppercase tracking-[0.18em]">
            Stajyor pasporti
          </span>
        </div>

        {/* who */}
        <div className="pt-[3.5mm]">
          <p className="text-[7.5pt] uppercase tracking-[0.14em] text-neutral-500">
            Стажёр · Stajyor
          </p>
          <p className="mt-[1mm] text-[21pt] font-bold leading-[1.05] tracking-tight">
            {invite.traineeName}
          </p>
          <p className="mt-[2mm] text-[11pt] leading-snug">
            {invite.programRu ?? "Программа не указана"}
            {invite.position ? (
              <span className="text-neutral-600"> · {invite.position}</span>
            ) : null}
          </p>
          {invite.programUz && (
            <p className="text-[10pt] leading-snug text-neutral-600">
              {invite.programUz}
            </p>
          )}
        </div>

        {/* the code */}
        <div className="flex flex-col items-center pt-[4mm]">
          {url ? (
            // No border, no padding wrapper: the 4-module quiet zone is drawn
            // INSIDE the svg, and anything dark placed against it would undo
            // that. The white square IS the frame.
            <div className="h-[50mm] w-[50mm] bg-white">
              <QRCodeSVG
                value={url}
                size={1024}
                // Q = 25% redundancy. The payload is a short URL, so the
                // extra modules cost nothing and buy a fold, a thumbprint
                // and a bad photocopy.
                level="Q"
                marginSize={4}
                bgColor="#ffffff"
                fgColor="#000000"
                style={{ width: "100%", height: "100%", display: "block" }}
              />
            </div>
          ) : (
            <div className="flex h-[50mm] w-[50mm] flex-col items-center justify-center gap-[2mm] border-2 border-dashed border-neutral-400 px-[4mm] text-center">
              <p className="text-[10pt] font-bold">QR не сформирован</p>
              <p className="text-[8pt] leading-snug text-neutral-600">
                Бот паспорта не настроен в этой сборке админки. Печать этой
                страницы выключена.
              </p>
            </div>
          )}

          {url && (
            <p className="mt-[2mm] max-w-[100mm] break-all text-center font-mono text-[7pt] leading-[1.3] text-neutral-600">
              {url}
            </p>
          )}
        </div>

        {/* validity */}
        <div className="mt-[3mm] border-2 border-black px-[4mm] py-[2mm] text-center">
          <p className="text-[11pt] font-bold leading-tight">
            Действует до {fmtLongDate(invite.expiresAt)}
          </p>
          <p className="text-[10pt] leading-tight">
            {fmtUzDate(invite.expiresAt)} gacha amal qiladi
          </p>
        </div>

        {/* instructions, two languages, equal weight */}
        <div className="mt-[3mm] grid grid-cols-2 gap-x-[6mm] border-t border-neutral-300 pt-[3mm]">
          <Steps
            title="Как открыть паспорт"
            steps={[
              "Наведите камеру телефона на QR-код.",
              "Откроется Telegram — нажмите «Начать».",
              "Паспорт откроется сам: ваши темы, сроки и отметки наставника.",
            ]}
            warning="Код одноразовый: он сработает у того, кто отсканирует первым. Не передавайте листок другим. Если код не сработал или срок истёк — попросите новый у менеджера."
          />
          <Steps
            title="Pasportni qanday ochish kerak"
            steps={[
              "Telefon kamerasini QR-kodga qarating.",
              "Telegram ochiladi — «Boshlash» tugmasini bosing.",
              "Pasport o‘zi ochiladi: mavzularingiz, muddatlar va murabbiy belgilari.",
            ]}
            warning="Kod bir martalik: u birinchi skanerlagan odamda ishlaydi. Varaqni boshqalarga bermang. Kod ishlamasa yoki muddati o‘tsa — menejerdan yangisini so‘rang."
          />
        </div>

        {/* footer */}
        <div className="mt-auto border-t border-neutral-300 pt-[2mm] text-[7pt] leading-[1.35] text-neutral-500">
          <p>
            Филиал · Filial: {invite.branch} · Выдан ·{" "}
            {fmtLongDate(Date.now())}
          </p>
          <p className="font-mono">{invite.inviteId}</p>
        </div>
      </div>
    </div>,
    document.body
  );
}
