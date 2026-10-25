"use client";
import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@admin/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@admin/components/ui/table";
import { kpiApi, type Card, type CardItem } from "@admin/lib/kpi-api";
import { kpiErrorText, shouldRetry } from "@admin/lib/kpi/errors";
import { SOURCE_LABEL } from "@admin/lib/kpi/status";
import { KpiBadge } from "../../_components/kpi-badge";
import { qk } from "../../_components/use-kpi";
import { CardDialog } from "./card-dialog";
import { ItemDialog } from "./item-dialog";

// Диалоги держим отдельным состоянием: открытый диалог переживает обновление списка карт.
type CardTarget = { card: Card | null } | null;
type ItemTarget = { cardId: string; item: CardItem | null } | null;

export function CardsTab() {
  const list = useQuery<Card[], Error>({
    queryKey: qk.cards(true),
    queryFn: () => kpiApi.cards.list(true),
    retry: shouldRetry,
  });
  const [cardTarget, setCardTarget] = useState<CardTarget>(null);
  const [itemTarget, setItemTarget] = useState<ItemTarget>(null);
  const cards = list.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button type="button" className="h-11" onClick={() => setCardTarget({ card: null })}>
          Новая карта
        </Button>
      </div>

      {list.error ? (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">
          {kpiErrorText(list.error)}
        </p>
      ) : list.isPending ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : cards.length === 0 ? (
        <p className="text-sm text-muted-foreground">Карт пока нет. Нажмите «Новая карта».</p>
      ) : (
        cards.map((card) => (
          <section key={card.id} className="space-y-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{card.title_ru}</h2>
              <code className="text-xs text-muted-foreground">{card.code}</code>
              {!card.active && <KpiBadge tone="gray">Отключена</KpiBadge>}
              <div className="ml-auto flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="h-11" onClick={() => setCardTarget({ card })}>
                  Изменить
                </Button>
                <Button type="button" variant="outline" className="h-11" onClick={() => setItemTarget({ cardId: card.id, item: null })}>
                  Добавить пункт
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">Должности:</span>
              {card.staff_role_codes.length === 0 ? (
                <span className="text-muted-foreground">только вручную</span>
              ) : (
                card.staff_role_codes.map((code) => (
                  <span key={code} className="rounded-full border bg-muted px-2.5 py-0.5 text-xs">
                    {code}
                  </span>
                ))
              )}
            </div>

            {card.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">В карте нет пунктов</p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">№</TableHead>
                      <TableHead>Пункт</TableHead>
                      <TableHead>Источник</TableHead>
                      <TableHead className="text-right">Вес</TableHead>
                      <TableHead>Группа</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {card.items.map((item) => (
                      <TableRow key={item.id} className={item.active ? undefined : "opacity-60"}>
                        <TableCell className="tabular-nums">{item.sort}</TableCell>
                        <TableCell>
                          <span>{item.title_ru}</span>
                          {!item.active && (
                            <span className="ml-2">
                              <KpiBadge tone="gray">Отключён</KpiBadge>
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {SOURCE_LABEL[item.source]}
                          {item.source !== "manual" && <span className="text-muted-foreground"> (пока вручную)</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{item.weight}</TableCell>
                        <TableCell>{item.group_key === "base" ? "Основной" : "Дополнительный"}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-11"
                            onClick={() => setItemTarget({ cardId: card.id, item })}
                          >
                            Изменить
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        ))
      )}

      <CardDialog card={cardTarget?.card ?? null} open={cardTarget !== null} onClose={() => setCardTarget(null)} />
      <ItemDialog
        cardId={itemTarget?.cardId ?? ""}
        item={itemTarget?.item ?? null}
        open={itemTarget !== null}
        onClose={() => setItemTarget(null)}
      />
    </div>
  );
}

export { CardDialog } from "./card-dialog";
export { ItemDialog } from "./item-dialog";
