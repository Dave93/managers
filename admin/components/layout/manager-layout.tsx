"use client";
import React, { useState, useRef, useEffect } from "react";
import { ClipboardList } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import CanAccess from "@admin/components/can-access";

const itemClass =
  "inline-flex flex-col items-center justify-center px-2 hover:bg-gray-50 dark:hover:bg-gray-800 group";
const iconClass =
  "w-5 h-5 mb-2 text-gray-500 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-500";
const labelClass =
  "text-xs text-gray-500 dark:text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-500";

// Secondary destinations live in the "Ещё" dropdown so the bar itself never
// overflows on narrow screens.
function MoreMenu() {
  const t = useTranslations("inventory");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
    };
  }, []);

  return (
    <div className="relative flex" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`${itemClass} w-full`}
      >
        <svg
          className={iconClass}
          aria-hidden="true"
          xmlns="http://www.w3.org/2000/svg"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <circle cx="4" cy="10" r="2" />
          <circle cx="10" cy="10" r="2" />
          <circle cx="16" cy="10" r="2" />
        </svg>
        <span className={labelClass}>Ещё</span>
      </button>
      {open && (
        <div className="absolute bottom-16 right-0 z-50 min-w-44 rounded-xl border border-gray-200 bg-white shadow-lg dark:bg-gray-800 dark:border-gray-600 py-1">
          <Link
            href="/admin/asrabox-stock"
            onClick={() => setOpen(false)}
            className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <svg
              className="w-5 h-5 text-gray-500 dark:text-gray-400"
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"
              />
            </svg>
            Asrabox
          </Link>
          <CanAccess permission="inventory.count">
            <Link
              href="/inventory"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <ClipboardList aria-hidden="true" className="w-5 h-5 text-gray-500 dark:text-gray-400" />
              {t("title")}
            </Link>
          </CanAccess>
          <CanAccess permission="medical.list">
            <Link
              href="/medical"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              <svg
                className="w-5 h-5 text-gray-500 dark:text-gray-400"
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 3.75a.75.75 0 00-.75.75v4.5a5.25 5.25 0 0010.5 0V4.5a.75.75 0 00-.75-.75h-1.5m-6 0h-1.5m9.75 9.75v1.5a5.25 5.25 0 01-5.25 5.25v0a5.25 5.25 0 01-5.25-5.25M18.75 13.5a2.25 2.25 0 100-4.5 2.25 2.25 0 000 4.5zm0 0v3a5.25 5.25 0 01-5.25 5.25"
                />
              </svg>
              Медосмотр
            </Link>
          </CanAccess>
        </div>
      )}
    </div>
  );
}

export default function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // pb-20: нижнее меню закреплено (h-16) и иначе закрывает конец длинных страниц.
    <div className="md:container pb-20">
      {children}
      <div className="fixed bottom-0 left-0 z-50 w-full h-16 bg-white border-t border-gray-200 dark:bg-gray-700 dark:border-gray-600">
        <div className="grid h-full max-w-lg grid-cols-6 mx-auto font-medium">
          <Link href="/" type="button" className={itemClass}>
            <svg
              className={iconClass}
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="m19.707 9.293-2-2-7-7a1 1 0 0 0-1.414 0l-7 7-2 2a1 1 0 0 0 1.414 1.414L2 10.414V18a2 2 0 0 0 2 2h3a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h3a2 2 0 0 0 2-2v-7.586l.293.293a1 1 0 0 0 1.414-1.414Z" />
            </svg>
            <span className={labelClass}>Главная</span>
          </Link>

          <Link href="/manager_reports" type="button" className={itemClass}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={iconClass}
            >
              <path
                fillRule="evenodd"
                d="M3 3.5A1.5 1.5 0 0 1 4.5 2h6.879a1.5 1.5 0 0 1 1.06.44l4.122 4.12A1.5 1.5 0 0 1 17 7.622V16.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16.5v-13ZM13.25 9a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5a.75.75 0 0 1 .75-.75Zm-6.5 4a.75.75 0 0 1 .75.75v.5a.75.75 0 0 1-1.5 0v-.5a.75.75 0 0 1 .75-.75Zm4-1.25a.75.75 0 0 0-1.5 0v2.5a.75.75 0 0 0 1.5 0v-2.5Z"
                clipRule="evenodd"
              />
            </svg>
            <span className={labelClass}>Отчеты</span>
          </Link>

          <CanAccess permission="stoplist.list">
            <Link href="/stoplist" type="button" className={itemClass}>
              <svg
                className={iconClass}
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" d="M5.7 5.7l12.6 12.6" />
              </svg>
              <span className={labelClass}>Стоп-лист</span>
            </Link>
          </CanAccess>

          <CanAccess permission="attestation.run">
            <Link href="/attestation/kiosk" type="button" className={itemClass}>
              <svg
                className={iconClass}
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.8}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 14l9-5-9-5-9 5 9 5z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 14l6.16-3.42A12 12 0 0112 21a12 12 0 01-6.16-10.42L12 14z"
                />
              </svg>
              <span className={labelClass}>Аттестация</span>
            </Link>
          </CanAccess>

          <MoreMenu />

          <Link href="/profile" type="button" className={itemClass}>
            <svg
              className={iconClass}
              aria-hidden="true"
              xmlns="http://www.w3.org/2000/svg"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path d="M10 0a10 10 0 1 0 10 10A10.011 10.011 0 0 0 10 0Zm0 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Zm0 13a8.949 8.949 0 0 1-4.951-1.488A3.987 3.987 0 0 1 9 13h2a3.987 3.987 0 0 1 3.951 3.512A8.949 8.949 0 0 1 10 18Z" />
            </svg>
            <span className={labelClass}>Profile</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
