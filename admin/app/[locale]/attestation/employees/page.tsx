"use client";
import { useEffect } from "react";
import { useRouter } from "@admin/i18n/routing";

// Справочник сотрудников переехал в общее меню: на него опираются и аттестация,
// и паспорт стажёра, поэтому держать его внутри одного из разделов неверно —
// и его прежний layout требовал прав аттестации, из-за чего HR с employees.list
// видел пустой экран. Старый адрес остаётся живым ради закладок и ссылок,
// разосланных до переезда. Клиентский редирект по образцу /passport: локаль-
// зависимый роутер сохраняет префикс /<locale>, а replace() не оставляет
// промежуточную запись в истории кнопки «назад».
export default function MovedEmployeesPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/employees");
  }, [router]);
  return <></>;
}
