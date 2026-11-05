// «Моя посещаемость»: рисует вид view/attendance.ts. Заголовок, под ним переключатель месяцев
// (соседи с данными: ссылка «‹ Месяц» слева, «Месяц ›» справа), ниже карточка со строками дней
// или «Данных за месяц нет». Что показывать, решает модель; здесь разметка и подписи «Приход» и «Уход».
//
// У отсутствующего соседа его место в переключателе остаётся пустым той же ширины, поэтому
// подпись месяца не смещается. Строки дней не ссылки (is-static): слева день и время прихода
// и ухода, справа пометка «не вышел» или «опоздание N мин».
//
// Строки с сервера в DOM попадают только текстом через h().
import { t } from "../i18n";
import { navigate } from "../nav";
import { parseHash } from "../route";
import { h } from "../ui";
import type { AttendanceNavVM, AttendanceRowVM, AttendanceVM } from "../view/attendance";

/** Ссылка внутри приложения: href для доступности, переход — через роутер (стек «назад»). */
function inAppLink(hash: string, cls: string, aria: string, ...kids: (Node | string | null)[]): HTMLElement {
  return h(
    "a",
    {
      class: cls,
      href: hash,
      "aria-label": aria,
      onclick: (e: Event) => {
        e.preventDefault();
        navigate(parseHash(hash));
      },
    },
    ...kids,
  );
}

/** Ссылка на соседний месяц; без соседа — пустое место той же ширины. */
function slot(n: AttendanceNavVM | null, side: "prev" | "next"): HTMLElement {
  if (n === null) return h("span", { class: "att-slot", "aria-hidden": "true" });
  // Имя для чтения с экрана начинается с видимой надписи (WCAG 2.5.3): «Октябрь, Предыдущий месяц».
  return inAppLink(n.hash, "btn btn-quiet att-slot", `${n.label}, ${n.aria}`, side === "prev" ? `‹ ${n.label}` : `${n.label} ›`);
}

function rowOf(r: AttendanceRowVM): HTMLElement {
  // Пара «Приход 08:55» не рвётся, перенос возможен только у точки между парами.
  const times = r.times
    ? h(
        "span",
        { class: "att-times" },
        h("span", { class: "att-pair" }, `${t("att_in")} ${r.times.in}`),
        " · ",
        h("span", { class: "att-pair" }, `${t("att_out")} ${r.times.out}`),
      )
    : null;
  const chip = r.dayOff !== null ? h("span", { class: "chip chip-muted" }, r.dayOff) : r.absent !== null ? h("span", { class: "chip chip-warn" }, r.absent) : r.late !== null ? h("span", { class: "chip chip-wait" }, r.late) : null;
  return h("div", { class: "row is-static" }, h("span", { class: "row-body" }, h("span", { class: "row-text" }, r.day, times), chip ? h("span", { class: "row-end" }, chip) : null));
}

export function renderAttendance(vm: AttendanceVM): HTMLElement {
  return h(
    "main",
    { class: "screen attendance" },
    h("h1", { class: "title" }, vm.title),
    h("div", { class: "att-switch" }, slot(vm.prev, "prev"), h("h2", { class: "att-month" }, vm.month), slot(vm.next, "next")),
    vm.empty !== null ? h("p", { class: "card hist-empty", role: "status" }, vm.empty) : h("section", { class: "card rows" }, ...vm.rows.map(rowOf)),
  );
}
