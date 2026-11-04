// Общие куски экранов оценщика (без DOM-состояния).
import { navigate } from "../nav";
import { parseHash } from "../route";
import { chevron, h } from "../ui";

/** Ссылка внутри приложения: href для доступности, переход — через роутер (стек «назад»). */
export function inAppLink(hash: string, cls: string, ...kids: (Node | string | null)[]): HTMLElement {
  return h(
    "a",
    {
      class: cls,
      href: hash,
      onclick: (e: Event) => {
        e.preventDefault();
        navigate(parseHash(hash));
      },
    },
    ...kids,
  );
}

/** Строка-ссылка карточки `.rows`: текст слева, необязательная пометка справа, шеврон. */
export function linkRow(text: string, end: string | null, hash: string): HTMLElement {
  return inAppLink(hash, "row", h("span", { class: "row-body" }, h("span", { class: "row-text" }, text), end === null ? null : h("span", { class: "row-end" }, end), chevron()));
}

/** Заменить детей элемента. replaceChildren есть только с Chrome 86, а нижняя граница WebView — Chrome 64. */
export function fill(el: HTMLElement, kids: (Node | null)[]): void {
  while (el.firstChild) el.removeChild(el.firstChild);
  for (const k of kids) if (k) el.appendChild(k);
}
