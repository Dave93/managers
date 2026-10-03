import { drizzleDb } from "../../lib/db";
import { ticket_types } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";
import { validateSchema, type FieldDef } from "./fields";

const opt = (value: string, ru: string, uz: string) => ({ value, label_ru: ru, label_uz: uz });

const AD_TV: FieldDef[] = [
  {
    key: "tv_place",
    type: "select",
    required: true,
    label_ru: "Какой телевизор",
    label_uz: "Qaysi televizor",
    options: [
      opt("hall", "Зал", "Zal"),
      opt("kitchen", "Кухня", "Oshxona"),
      opt("window", "Витрина", "Vitrina"),
      opt("other", "Другой", "Boshqa"),
    ],
  },
  {
    key: "symptom",
    type: "select",
    required: true,
    label_ru: "Что происходит",
    label_uz: "Nima bo'lyapti",
    options: [
      opt("no_power", "Не включается", "Yoqilmayapti"),
      opt("black_screen", "Чёрный экран", "Qora ekran"),
      opt("no_signal", "Нет картинки с плеера", "Pleerdan tasvir yo'q"),
      opt("frozen", "Зависла картинка", "Tasvir qotib qolgan"),
      opt("no_sound", "Нет звука", "Ovoz yo'q"),
      opt("other", "Другое", "Boshqa"),
    ],
  },
  { key: "note", type: "text", required: false, label_ru: "Описание", label_uz: "Izoh" },
];

const CAMERAS: FieldDef[] = [
  {
    key: "broken_part",
    type: "select",
    required: true,
    label_ru: "Что сломано",
    label_uz: "Nima buzilgan",
    options: [
      opt("camera", "Конкретная камера", "Muayyan kamera"),
      opt("dvr", "Видеорегистратор", "Videoregistrator"),
      opt("no_record", "Нет записи", "Yozuv yo'q"),
      opt("no_remote", "Нет удалённого доступа", "Masofaviy kirish yo'q"),
    ],
  },
  {
    key: "zone",
    type: "select",
    required: true,
    label_ru: "Зона",
    label_uz: "Hudud",
    options: [
      opt("cashier", "Касса", "Kassa"),
      opt("hall", "Зал", "Zal"),
      opt("kitchen", "Кухня", "Oshxona"),
      opt("storage", "Склад", "Ombor"),
      opt("street", "Улица", "Ko'cha"),
    ],
  },
  { key: "note", type: "text", required: false, label_ru: "Описание", label_uz: "Izoh" },
];

const TYPES = [
  { code: "ad_tv", number_prefix: "TV", name_ru: "Реклама ТВ", name_uz: "Reklama TV", icon: "tv", schema: AD_TV },
  { code: "cameras", number_prefix: "CAM", name_ru: "Камеры", name_uz: "Kameralar", icon: "cctv", schema: CAMERAS },
];

async function main() {
  for (const t of TYPES) {
    const check = validateSchema(t.schema);
    if (!check.ok) {
      console.error(`${t.code}: схема невалидна`, check.errors);
      process.exit(1);
    }
    const existing = await drizzleDb
      .select({ id: ticket_types.id })
      .from(ticket_types)
      .where(eq(ticket_types.code, t.code))
      .execute();
    if (existing.length) {
      console.log(`skip ${t.code} (exists)`);
      continue;
    }
    // contractor_id остаётся пустым: фирмы заводит владелец в админке, и
    // привязка типа к фирме — его решение, а не решение сида.
    await drizzleDb
      .insert(ticket_types)
      .values({
        code: t.code,
        number_prefix: t.number_prefix,
        name_ru: t.name_ru,
        name_uz: t.name_uz,
        icon: t.icon,
        executor_kind: "external",
        fields_schema: check.schema,
      })
      .execute();
    console.log(`inserted ${t.code}`);
  }
  console.log("done");
  process.exit(0);
}

main();
