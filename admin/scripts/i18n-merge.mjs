// Слияние переводов в admin/messages/{ru,uz-Latn,uz-Cyrl,en}.json.
//
// Использование: node scripts/i18n-merge.mjs <spec.json>
//
// spec — вложенный объект, листья которого массивы [ru, uz, en]:
//   { "nav": { "settings": ["Настройки", "Sozlamalar", "Settings"] } }
// uz — узбекский латиницей; uz-Cyrl получается из него транслитерацией
// (слова из PROTECTED остаются латиницей, {плейсхолдеры} не трогаются).
// Существующие ключи перезаписываются, остальные сохраняются.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "messages");

// Бренды, аббревиатуры и названия систем не транслитерируем.
const PROTECTED = [
  "iikoCloud", "iikoServer", "iikoFront", "iikoOffice", "iiko", "Les Ailes", "Chopar", "KPI", "HR", "PIN", "Excel", "CSV",
  "Workly", "HUMO", "UZCARD", "Uzcard", "Payme", "Click", "Yandex", "Uzum Tezkor", "WOLT", "OLAP", "API", "ID", "QR",
  "SMS", "PDF", "Telegram", "Telegram", "POS", "RMS", "SKU", "NPS", "FIFO", "COGS",
];

const APOS = "['‘’ʻʼ`]";

// Порядок важен: сначала диграфы.
function translitWord(s) {
  const rules = [
    [new RegExp(`O${APOS}`, "g"), "Ў"], [new RegExp(`o${APOS}`, "g"), "ў"],
    [new RegExp(`G${APOS}`, "g"), "Ғ"], [new RegExp(`g${APOS}`, "g"), "ғ"],
    [/Sh/g, "Ш"], [/SH/g, "Ш"], [/sh/g, "ш"],
    [/Ch/g, "Ч"], [/CH/g, "Ч"], [/ch/g, "ч"],
    [/Yo/g, "Ё"], [/YO/g, "Ё"], [/yo/g, "ё"],
    [/Yu/g, "Ю"], [/YU/g, "Ю"], [/yu/g, "ю"],
    [/Ya/g, "Я"], [/YA/g, "Я"], [/ya/g, "я"],
    [/Ye/g, "Е"], [/YE/g, "Е"], [/ye/g, "е"],
    [/Ts/g, "Ц"], [/ts/g, "ц"],
  ];
  let out = s;
  for (const [re, to] of rules) out = out.replace(re, to);
  // э в начале слова и после гласной / е иначе.
  out = out.replace(/(^|[^А-Яа-яЁёЎўҒғҚқҲҳA-Za-z])E/g, "$1Э").replace(/(^|[^А-Яа-яЁёЎўҒғҚқҲҳA-Za-z])e/g, "$1э");
  // Отдельный апостроф (тутуқ белгиси) после гласной -> ъ.
  out = out.replace(new RegExp(APOS, "g"), "ъ");
  const map = {
    a: "а", b: "б", d: "д", e: "е", f: "ф", g: "г", h: "ҳ", i: "и", j: "ж", k: "к", l: "л", m: "м", n: "н",
    o: "о", p: "п", q: "қ", r: "р", s: "с", t: "т", u: "у", v: "в", x: "х", y: "й", z: "з", c: "с", w: "в",
  };
  return out.replace(/[A-Za-z]/g, (ch) => {
    const lower = ch.toLowerCase();
    const m = map[lower];
    if (!m) return ch;
    return ch === lower ? m : m.toUpperCase();
  });
}

// Литеральный текст без ICU: защищённые слова и теги остаются как есть.
const literalRe = new RegExp(
  `(</?[a-zA-Z][a-zA-Z0-9]*>|${PROTECTED.map((w) => w.replace(/[.*+?^${}()|[]\]/g, "\$&")).join("|")})`,
  "g",
);
function translitLiteral(text) {
  return text
    .split(literalRe)
    .map((part, i) => (i % 2 === 1 ? part : translitWord(part)))
    .join("");
}

// ICU-aware: переводим только литералы; имена аргументов, типы (plural/select) и
// ключевые слова веток (one/other/=0/decrease) остаются как есть.
export function toCyrillic(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "{") {
      let j = text.indexOf("{", i);
      if (j === -1) j = text.length;
      out += translitLiteral(text.slice(i, j));
      i = j;
      continue;
    }
    // найти парную }
    let depth = 0, k = i;
    for (; k < text.length; k++) {
      if (text[k] === "{") depth++;
      else if (text[k] === "}" && --depth === 0) break;
    }
    const inner = text.slice(i + 1, k);
    if (!inner.includes("{")) {
      out += "{" + inner + "}"; // простой плейсхолдер
    } else {
      // {name, plural, one {...} other {...}}
      let q = 0, res = "";
      while (q < inner.length) {
        const b = inner.indexOf("{", q);
        if (b === -1) { res += inner.slice(q); break; }
        res += inner.slice(q, b); // заголовок или ключевое слово ветки
        let d = 0, e = b;
        for (; e < inner.length; e++) {
          if (inner[e] === "{") d++;
          else if (inner[e] === "}" && --d === 0) break;
        }
        res += "{" + toCyrillic(inner.slice(b + 1, e)) + "}";
        q = e + 1;
      }
      out += "{" + res + "}";
    }
    i = k + 1;
  }
  return out;
}

function split(spec, out) {
  for (const [k, v] of Object.entries(spec)) {
    if (Array.isArray(v)) {
      const [ru, uz, en] = v;
      out.ru[k] = ru;
      out.uzLatn[k] = uz;
      out.uzCyrl[k] = toCyrillic(uz);
      out.en[k] = en;
    } else {
      for (const l of Object.keys(out)) out[l][k] = {};
      split(v, {
        ru: out.ru[k], uzLatn: out.uzLatn[k], uzCyrl: out.uzCyrl[k], en: out.en[k],
      });
    }
  }
}

function merge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== "object") target[k] = {};
      merge(target[k], v);
    } else {
      target[k] = v;
    }
  }
}

const specPath = process.argv[2];
if (specPath && import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const out = { ru: {}, uzLatn: {}, uzCyrl: {}, en: {} };
  split(spec, out);
  const files = { ru: "ru.json", uzLatn: "uz-Latn.json", uzCyrl: "uz-Cyrl.json", en: "en.json" };
  for (const [l, f] of Object.entries(files)) {
    const p = path.join(dir, f);
    const cur = JSON.parse(fs.readFileSync(p, "utf8"));
    merge(cur, out[l]);
    fs.writeFileSync(p, JSON.stringify(cur, null, 2).replace(/\n/g, "\r\n") + "\r\n");
  }
  console.log("merged", Object.keys(spec).join(", "));
}
