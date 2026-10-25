// Стартовые карты и шкала повышения. Тексты — раздел 6.1 спеки; апостроф в узбекском — ʻ (U+02BB).
import type { ItemSource } from "./rules";

export interface SeedItem {
  title_ru: string;
  title_uz: string;
  source: ItemSource;
  group_key: "base" | "extra";
}

export interface SeedCard {
  code: string;
  title_ru: string;
  title_uz: string;
  staff_role_codes: string[];
  sort: number;
  items: SeedItem[];
}

const base = (title_ru: string, title_uz: string, source: ItemSource = "manual"): SeedItem => ({
  title_ru,
  title_uz,
  source,
  group_key: "base",
});
const extra = (title_ru: string, title_uz: string, source: ItemSource = "manual"): SeedItem => ({
  title_ru,
  title_uz,
  source,
  group_key: "extra",
});

const cookItems: SeedItem[] = [
  base("Приход и уход", "Kelish va ketish", "attendance"),
  base("Чистота кухни", "Oshxona tozaligi"),
  base("Гигиена сотрудника", "Xodim gigiyenasi"),
  base("Порядок в остатках продуктов", "Mahsulot qoldiqlarida tartib"),
  base("Время и скорость приготовления заказа", "Buyurtmani tayyorlash vaqti va tezligi", "cooking_speed"),
  base("Соблюдение техкарты", "Texnologik kartaga rioya qilish"),
  base("Правильная приёмка продукции со склада", "Ombordan mahsulotni toʻgʻri qabul qilish"),
];

const seniorExtra: SeedItem[] = [
  extra("Удерживает поваров в команде", "Oshpazlarni jamoada ushlab qolish"),
  extra(
    "Отчёты вовремя: заказы на склад, дневные и месячные остатки, дневное списание, перемещения",
    "Hisobotlarni oʻz vaqtida yuritish: omborga buyurtmalar, kunlik va oylik qoldiqlar, kunlik hisobdan chiqarish, koʻchirishlar"
  ),
];

const cashierItems: SeedItem[] = [
  base("Приход и уход", "Kelish va ketish", "attendance"),
  base("Своя гигиена и форма", "Shaxsiy gigiyena va forma"),
  base("Чистота кассы", "Kassa tozaligi"),
  base(
    "Открывает и закрывает кассовые смены, работает с кассовыми терминалами, следит за стоп-листом",
    "Kassa smenalarini ochadi va yopadi, kassa terminallari bilan ishlaydi, stop-listni kuzatadi"
  ),
  base("Знает меню витрины по техкарте", "Vitrina menyusini texnologik karta boʻyicha biladi"),
];

const cashierPlusExtra: SeedItem[] = [
  extra("Хорошие доп. продажи", "Yaxshi qoʻshimcha savdo"),
  extra("Продаёт по скриптам продаж", "Savdo skriptlari boʻyicha sotadi"),
  extra("Умеет работать поваром", "Oshpaz boʻlib ishlay oladi"),
];

const managerItems: SeedItem[] = [
  base("Приход и уход", "Kelish va ketish", "attendance"),
  base("Форма и гигиена", "Forma va gigiyena"),
  base("Чистота филиала", "Filial tozaligi"),
  base(
    "Качество сервиса: как сотрудники обслуживают гостей, скорость приёма и выдачи заказа",
    "Xizmat sifati: xodimlar mehmonlarga qanday xizmat koʻrsatadi, buyurtmani qabul qilish va berish tezligi"
  ),
  base(
    "Качество приготовления и хранение продуктов по стандартам сроков хранения",
    "Taom tayyorlash sifati va mahsulotlarni saqlash muddati standartlari boʻyicha saqlash"
  ),
  base(
    "Правильно составляет заказ на склад и проверяет поставку",
    "Omborga buyurtmani toʻgʻri tuzadi va kelgan mahsulotni tekshiradi"
  ),
];

const managerExtra: SeedItem[] = [
  extra("Работа над планом продаж", "Savdo rejasi ustida ishlash", "sales_plan"),
  extra("Фудкост и остатки", "Fudkost va qoldiqlar", "food_cost"),
  extra("Кассовый отчёт", "Kassa hisoboti"),
];

const cleanerItems: SeedItem[] = [
  base("Приход и уход", "Kelish va ketish", "attendance"),
  base("Своя гигиена", "Shaxsiy gigiyena"),
  base("Чистота зала и уборной", "Zal va hojatxona tozaligi"),
];

export const SEED_CARDS: SeedCard[] = [
  {
    code: "cook",
    title_ru: "Повар (Chopar и Les Ailes)",
    title_uz: "Oshpaz (Chopar va Les Ailes)",
    staff_role_codes: ["cook", "universal_cook"],
    sort: 10,
    items: cookItems,
  },
  {
    code: "senior_cook",
    title_ru: "Старший повар",
    title_uz: "Katta oshpaz",
    staff_role_codes: ["senior_cook"],
    sort: 20,
    items: [...cookItems, ...seniorExtra],
  },
  {
    code: "cashier",
    title_ru: "Кассир",
    title_uz: "Kassir",
    staff_role_codes: ["cashier"],
    sort: 30,
    items: cashierItems,
  },
  {
    code: "cashier_plus",
    title_ru: "Кассир, оклад 4 000 000 сум",
    title_uz: "Kassir, maosh 4 000 000 soʻm",
    staff_role_codes: [],
    sort: 40,
    items: [...cashierItems, ...cashierPlusExtra],
  },
  {
    code: "manager",
    title_ru: "Менеджер филиала",
    title_uz: "Filial menejeri",
    staff_role_codes: ["manager"],
    sort: 50,
    items: [...managerItems, ...managerExtra],
  },
  {
    code: "cleaner",
    title_ru: "Техничка",
    title_uz: "Farrosh",
    staff_role_codes: [],
    sort: 60,
    items: cleanerItems,
  },
];

// Шкала повышения: от какого среднего процента какая сумма.
export const SEED_TIERS: { min_pct: number; amount: number }[] = [
  { min_pct: 95, amount: 500000 },
  { min_pct: 90, amount: 300000 },
  { min_pct: 85, amount: 150000 },
];
