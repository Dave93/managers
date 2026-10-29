import React from "react";
import { useTranslations } from "next-intl";
import { cn } from "@admin/lib/utils";
import { photoUrl } from "@admin/lib/kpi-api";

export function PhotoThumbs({ photos, size = "sm" }: { photos: { id: string }[]; size?: "sm" | "md" }) {
  const t = useTranslations("kpi");
  if (photos.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((p) => (
        <a key={p.id} href={photoUrl(p.id)} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoUrl(p.id)}
            alt={t("common.photoAlt")}
            loading="lazy"
            className={cn("rounded border object-cover", size === "sm" ? "size-14" : "size-20")}
          />
        </a>
      ))}
    </div>
  );
}
