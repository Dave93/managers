// Сидирование куррикулума паспорта стажёра: программы, модули, привязки, темы.
//
// Идемпотентно: программа опознаётся по position, модуль по паре (title_ru, brand),
// привязка по (program_id, module_id), тема по (module_id, sort). Повторный прогон
// обновляет содержимое, но не плодит строки и не трогает чужие данные.
//
// Всё создаётся в статусе draft: HR правит и публикует сам. Гейт публикации требует
// обе языковые версии всех четырёх полей и непустой чек-лист наблюдения — сидер это
// проверяет ДО записи и падает со списком нарушений, чтобы не создавать модули,
// которые потом молча не опубликуются.
import { drizzleDb } from "../../lib/db";
import {
  passport_programs,
  passport_modules,
  passport_program_modules,
  passport_topics,
} from "backend/drizzle/schema";
import { and, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";

type Bilingual = { ru: string; uz: string };
type TopicIn = {
  sort: number;
  title_ru: string; title_uz: string;
  step_ru: string; step_uz: string;
  key_point_ru: string; key_point_uz: string;
  reason_ru: string; reason_uz: string;
  verification_type: string;
  quiz_test_id: string | null;
  observation_checklist: { items: Bilingual[]; questions: Bilingual[] };
};

const PROGRAMS = [
  { position: "manager",        title_ru: "Менеджер филиала", title_uz: "Filial menejeri" },
  { position: "cashier",        title_ru: "Кассир",           title_uz: "Kassir" },
  { position: "expeditor",      title_ru: "Раздача",          title_uz: "Buyurtma berish" },
  { position: "cook",           title_ru: "Повар",            title_uz: "Oshpaz" },
  { position: "head_cook",      title_ru: "Старший повар",    title_uz: "Bosh oshpaz" },
  { position: "kitchen_helper", title_ru: "Работник кухни",   title_uz: "Oshxona xodimi" },
  { position: "hall_attendant", title_ru: "Работник зала",    title_uz: "Zal xodimi" },
  { position: "nanny",          title_ru: "Няня",             title_uz: "Enaga" },
];

const MODULES = [
  { key: "onboarding",       title_ru: "Первые дни в филиале",        title_uz: "Filialdagi dastlabki kunlar", brand: null,     dept: "hr" },
  { key: "appearance",       title_ru: "Внешний вид и дисциплина",    title_uz: "Tashqi ko'rinish va intizom", brand: null,     dept: "hr" },
  { key: "sanitation",       title_ru: "Санитария и гигиена",         title_uz: "Sanitariya va gigiena",       brand: null,     dept: "safety" },
  { key: "safety",           title_ru: "Техника безопасности",        title_uz: "Mehnat xavfsizligi",          brand: null,     dept: "safety" },
  { key: "storage_fifo",     title_ru: "Склад и ФИФО",                title_uz: "Ombor va FIFO",               brand: null,     dept: "control" },
  { key: "cash_register",    title_ru: "Касса и чеки",                title_uz: "Kassa va cheklar",            brand: null,     dept: "finance" },
  { key: "service_guests",   title_ru: "Гости, жалобы, сервис",       title_uz: "Mehmonlar va xizmat",         brand: null,     dept: "marketing" },
  { key: "products_promos",  title_ru: "Продукты и акции",            title_uz: "Mahsulotlar va aksiyalar",    brand: null,     dept: "marketing" },
  { key: "packing_delivery", title_ru: "Упаковка и выдача заказов",   title_uz: "Qadoqlash va buyurtma berish",brand: null,     dept: "front" },
  { key: "hall_cleanliness", title_ru: "Зал, санузлы, чистота",       title_uz: "Zal, hojatxona, tozalik",     brand: null,     dept: "control" },
  { key: "kids_area",        title_ru: "Детская площадка",            title_uz: "Bolalar maydonchasi",         brand: null,     dept: "hr" },

  { key: "mgr_daily_ops",    title_ru: "Операционный день менеджера", title_uz: "Menejerning ish kuni",        brand: null,     dept: "operations" },
  { key: "mgr_peak_reports", title_ru: "Пик и отчётность",            title_uz: "Pik vaqt va hisobot",         brand: null,     dept: "operations" },
  { key: "mgr_people",       title_ru: "Люди и дисциплина",           title_uz: "Xodimlar va intizom",         brand: null,     dept: "hr" },
  { key: "mgr_independent",  title_ru: "Самостоятельная смена",       title_uz: "Mustaqil smena",              brand: null,     dept: "operations" },
  { key: "mgr_it",           title_ru: "IT-системы филиала",          title_uz: "Filial IT tizimlari",         brand: null,     dept: "it" },
  { key: "mgr_hr",           title_ru: "Кадровые процессы",           title_uz: "Kadrlar jarayonlari",         brand: null,     dept: "hr" },
  { key: "mgr_finance",      title_ru: "Финансы и документы",         title_uz: "Moliya va hujjatlar",         brand: null,     dept: "finance" },
  { key: "mgr_control",      title_ru: "Внутренний контроль",         title_uz: "Ichki nazorat",               brand: null,     dept: "control" },

  { key: "ch_dough",         title_ru: "Станция теста",               title_uz: "Xamir stansiyasi",            brand: "chopar", dept: "kitchen_chopar" },
  { key: "ch_snacks",        title_ru: "Станция снеков",              title_uz: "Sneklar stansiyasi",          brand: "chopar", dept: "kitchen_chopar" },
  { key: "ch_prep",          title_ru: "Заготовка",                   title_uz: "Zagotovka",                   brand: "chopar", dept: "kitchen_chopar" },
  { key: "ch_equipment",     title_ru: "Оборудование кухни",          title_uz: "Oshxona jihozlari",           brand: "chopar", dept: "kitchen_chopar" },

  { key: "les_snacks",       title_ru: "Станция снеков",              title_uz: "Sneklar stansiyasi",          brand: "les",    dept: "kitchen_les" },
  { key: "les_burger",       title_ru: "Станция Лестер-бургер",       title_uz: "Lester burger stansiyasi",    brand: "les",    dept: "kitchen_les" },
  { key: "les_meat",         title_ru: "Станция мяса",                title_uz: "Go'sht stansiyasi",           brand: "les",    dept: "kitchen_les" },
  { key: "les_prep",         title_ru: "Заготовка",                   title_uz: "Zagotovka",                   brand: "les",    dept: "kitchen_les" },
  { key: "les_equipment",    title_ru: "Оборудование кухни",          title_uz: "Oshxona jihozlari",           brand: "les",    dept: "kitchen_les" },
];

type Link = [string, number, boolean, number]; // key, sort, required, deadline_days
const LINKS: Record<string, Link[]> = {
  manager: [
    ["onboarding",1,true,3],["appearance",2,true,5],["safety",3,true,7],["sanitation",4,true,10],
    ["mgr_daily_ops",5,true,10],["storage_fifo",6,true,14],["mgr_peak_reports",7,true,17],
    ["cash_register",8,true,17],["mgr_people",9,true,21],["mgr_hr",10,true,24],["mgr_it",11,true,24],
    ["mgr_finance",12,true,26],["mgr_control",13,true,26],["service_guests",14,true,28],
    ["products_promos",15,false,28],["hall_cleanliness",16,true,28],["mgr_independent",17,true,30],
  ],
  cashier: [
    ["onboarding",1,true,3],["appearance",2,true,5],["safety",3,true,7],["sanitation",4,true,10],
    ["cash_register",5,true,14],["service_guests",6,true,18],["products_promos",7,true,21],
    ["packing_delivery",8,true,24],["hall_cleanliness",9,false,28],
  ],
  expeditor: [
    ["onboarding",1,true,3],["appearance",2,true,5],["safety",3,true,7],["sanitation",4,true,10],
    ["packing_delivery",5,true,14],["products_promos",6,true,18],["service_guests",7,true,21],
    ["hall_cleanliness",8,false,25],
  ],
  cook: [
    ["onboarding",1,true,3],["appearance",2,true,5],["safety",3,true,7],["sanitation",4,true,10],
    ["storage_fifo",5,true,14],["ch_equipment",6,true,18],["ch_prep",7,true,21],["ch_dough",8,true,25],
    ["ch_snacks",9,true,28],["les_equipment",10,true,32],["les_prep",11,true,35],["les_snacks",12,true,38],
    ["les_burger",13,true,42],["les_meat",14,true,45],
  ],
  head_cook: [
    ["onboarding",1,true,3],["appearance",2,true,5],["safety",3,true,7],["sanitation",4,true,10],
    ["storage_fifo",5,true,14],["ch_equipment",6,true,18],["ch_prep",7,true,21],["ch_dough",8,true,25],
    ["ch_snacks",9,true,28],["les_equipment",10,true,32],["les_prep",11,true,35],["les_snacks",12,true,38],
    ["les_burger",13,true,42],["les_meat",14,true,45],["mgr_control",15,true,50],["hall_cleanliness",16,false,50],
  ],
  kitchen_helper: [
    ["onboarding",1,true,3],["appearance",2,true,5],["safety",3,true,7],["sanitation",4,true,10],
    ["ch_equipment",5,true,14],["les_equipment",6,true,18],["storage_fifo",7,false,21],
  ],
  hall_attendant: [
    ["onboarding",1,true,3],["appearance",2,true,5],["safety",3,true,7],["sanitation",4,true,10],
    ["hall_cleanliness",5,true,14],["service_guests",6,true,18],["products_promos",7,false,21],
  ],
  nanny: [
    ["onboarding",1,true,3],["appearance",2,true,5],["safety",3,true,7],["sanitation",4,true,10],
    ["kids_area",5,true,14],["service_guests",6,true,18],
  ],
};

// --- загрузка тем ---
const dir = process.env.TOPICS_DIR ?? ".";
const topicsByModule: Record<string, TopicIn[]> = {};
for (const part of ["A", "B", "C", "D"]) {
  const path = `${dir}/topics-${part}.json`;
  let raw: string;
  try { raw = readFileSync(path, "utf8"); } catch { console.log(`пропуск: ${path} нет`); continue; }
  const parsed = JSON.parse(raw) as Record<string, TopicIn[]>;
  for (const [k, v] of Object.entries(parsed)) {
    if (topicsByModule[k]) throw new Error(`модуль ${k} встречается в двух файлах`);
    topicsByModule[k] = v;
  }
}

// --- проверка ДО записи: то же, что проверит гейт публикации ---
const problems: string[] = [];
for (const [key, topics] of Object.entries(topicsByModule)) {
  if (!MODULES.some((m) => m.key === key)) problems.push(`неизвестный модуль в JSON: ${key}`);
  if (!topics.length) problems.push(`${key}: нет тем`);
  topics.forEach((t, i) => {
    for (const f of ["title","step","key_point","reason"] as const) {
      for (const l of ["ru","uz"] as const) {
        if (!String((t as any)[`${f}_${l}`] ?? "").trim()) problems.push(`${key} тема ${i+1}: пустое ${f}_${l}`);
      }
    }
    if (t.verification_type !== "observation" && t.verification_type !== "quiz" && t.verification_type !== "quiz_observation")
      problems.push(`${key} тема ${i+1}: тип ${t.verification_type} нельзя опубликовать`);
    if (t.verification_type !== "quiz") {
      const cl = t.observation_checklist;
      if (!cl || !Array.isArray(cl.items) || !cl.items.length) problems.push(`${key} тема ${i+1}: пустой items`);
      if (!cl || !Array.isArray(cl.questions)) problems.push(`${key} тема ${i+1}: questions не массив`);
    }
  });
}
if (problems.length) {
  console.error("НЕ СИДИРУЮ — контент не пройдёт гейт публикации:");
  problems.slice(0, 40).forEach((p) => console.error("  " + p));
  if (problems.length > 40) console.error(`  ... и ещё ${problems.length - 40}`);
  process.exit(1);
}

// --- запись ---
const programIds: Record<string, string> = {};
for (const p of PROGRAMS) {
  const found = await drizzleDb.select({ id: passport_programs.id }).from(passport_programs)
    .where(eq(passport_programs.position, p.position)).execute();
  if (found.length) {
    programIds[p.position] = found[0].id;
    await drizzleDb.update(passport_programs)
      .set({ title_ru: p.title_ru, title_uz: p.title_uz })
      .where(eq(passport_programs.id, found[0].id)).execute();
    console.log(`программа = ${p.position}`);
  } else {
    const [row] = await drizzleDb.insert(passport_programs)
      .values({ position: p.position, title_ru: p.title_ru, title_uz: p.title_uz, active: true })
      .returning().execute();
    programIds[p.position] = row.id;
    console.log(`программа + ${p.position}`);
  }
}

const moduleIds: Record<string, string> = {};
for (const m of MODULES) {
  const where = m.brand
    ? and(eq(passport_modules.title_ru, m.title_ru), eq(passport_modules.brand, m.brand))
    : and(eq(passport_modules.title_ru, m.title_ru), eq(passport_modules.owner_department, m.dept));
  const found = await drizzleDb.select({ id: passport_modules.id, status: passport_modules.status })
    .from(passport_modules).where(where).execute();
  if (found.length) {
    moduleIds[m.key] = found[0].id;
    if (found[0].status === "published") { console.log(`модуль ! ${m.key} опубликован — не трогаю`); continue; }
    await drizzleDb.update(passport_modules)
      .set({ title_uz: m.title_uz, owner_department: m.dept, updated_at: new Date().toISOString() })
      .where(eq(passport_modules.id, found[0].id)).execute();
    console.log(`модуль = ${m.key}`);
  } else {
    const [row] = await drizzleDb.insert(passport_modules).values({
      title_ru: m.title_ru, title_uz: m.title_uz, brand: m.brand,
      owner_department: m.dept, status: "draft", active: true,
    }).returning().execute();
    moduleIds[m.key] = row.id;
    console.log(`модуль + ${m.key}`);
  }
}

let linked = 0;
for (const [position, links] of Object.entries(LINKS)) {
  const pid = programIds[position];
  for (const [key, sort, required, days] of links) {
    const mid = moduleIds[key];
    if (!mid) throw new Error(`нет модуля ${key} для ${position}`);
    const found = await drizzleDb.select({ id: passport_program_modules.id }).from(passport_program_modules)
      .where(and(eq(passport_program_modules.program_id, pid), eq(passport_program_modules.module_id, mid))).execute();
    if (found.length) {
      await drizzleDb.update(passport_program_modules)
        .set({ sort, required, deadline_days: days })
        .where(eq(passport_program_modules.id, found[0].id)).execute();
    } else {
      await drizzleDb.insert(passport_program_modules)
        .values({ program_id: pid, module_id: mid, sort, required, deadline_days: days }).execute();
    }
    linked++;
  }
}
console.log(`привязок: ${linked}`);

let added = 0, updated = 0, skipped = 0;
for (const [key, topics] of Object.entries(topicsByModule)) {
  const mid = moduleIds[key];
  const mod = await drizzleDb.select({ status: passport_modules.status }).from(passport_modules)
    .where(eq(passport_modules.id, mid)).execute();
  if (mod[0]?.status === "published") { skipped += topics.length; continue; }
  for (const t of topics) {
    const found = await drizzleDb.select({ id: passport_topics.id }).from(passport_topics)
      .where(and(eq(passport_topics.module_id, mid), eq(passport_topics.sort, t.sort))).execute();
    const values = {
      module_id: mid, sort: t.sort,
      title_ru: t.title_ru, title_uz: t.title_uz,
      step_ru: t.step_ru, step_uz: t.step_uz,
      key_point_ru: t.key_point_ru, key_point_uz: t.key_point_uz,
      reason_ru: t.reason_ru, reason_uz: t.reason_uz,
      verification_type: t.verification_type as any,
      quiz_test_id: t.quiz_test_id,
      observation_checklist: t.observation_checklist,
      active: true,
    };
    if (found.length) {
      await drizzleDb.update(passport_topics).set(values).where(eq(passport_topics.id, found[0].id)).execute();
      updated++;
    } else {
      await drizzleDb.insert(passport_topics).values(values).execute();
      added++;
    }
  }
}
console.log(`темы: +${added} =${updated} пропущено(опубликованные) ${skipped}`);
console.log("готово. Всё в статусе draft — публикует HR.");
process.exit(0);
