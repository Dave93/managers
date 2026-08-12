// Two languages, and both are first class: Russian and Uzbek LATIN. Every
// string the trainee can ever see lives here, so a missing translation is a
// TypeScript error rather than a Russian sentence leaking into the Uzbek UI
// (`Record<Lang, Dict>` over a shared `Dict` shape is what enforces that).
//
// HONESTY NOTE, and it constrains the copy: the backend has NO route that
// writes `passport_tg_bindings.lang`. `POST /passport/tg/auth` only READS it
// (its upsert deliberately preserves it), and there is no PATCH anywhere in the
// passport module. So the switcher below persists the choice in this phone's
// localStorage and nowhere else. The UI therefore never claims the language is
// "saved to your profile" -- it just switches, silently and locally.
export type Lang = "ru" | "uz";

const LANG_KEY = "passport_lang";

export function isLang(v: unknown): v is Lang {
  return v === "ru" || v === "uz";
}

// localStorage throws in some embedded WebViews when storage is blocked. A
// language switcher must never be the thing that white-screens the app, so
// every access is guarded.
export function storedLang(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

function persistLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* storage disabled: the choice simply lasts for this session */
  }
}

let current: Lang = storedLang() ?? "ru";

export function lang(): Lang {
  return current;
}

function syncDocument(): void {
  document.documentElement.lang = current;
}

/**
 * `fromUser` is the whole rule: the person's own choice always wins over the
 * server's `lang`, because the server has no way to record that they switched.
 * A server value only seeds a phone that has never chosen.
 */
export function setLang(next: Lang, fromUser: boolean): void {
  if (fromUser || !storedLang()) {
    current = next;
    if (fromUser) persistLang(next);
  }
  syncDocument();
}

// Every terminal state the shell can land in. One key per DISTINCT thing that
// actually happened -- a single "denied" bucket would send a person with a
// perfectly good account to IT because somebody else had scanned their QR.
export type StatusKey =
  | "outside_telegram"
  | "no_access"
  | "banned"
  | "wrong_account"
  | "expired"
  | "not_configured"
  | "not_started"
  | "offline"
  | "unknown";

/** The four stamp kinds `passport_stamps.type` can hold. */
export type StampType =
  | "module_cert"
  | "universal_chopar"
  | "universal_les"
  | "probation_passed";

/**
 * The passport screen's own vocabulary.
 *
 * The level words are LIFTED FROM THE OFFICE ADMIN, verbatim
 * (admin/app/[locale]/passport/matrix/_components/level.tsx): «Увидел»,
 * «Сделал», «Сам», «Учит других». A manager reading the matrix and a trainee
 * reading this screen have to be able to say "у тебя по этой теме сделал" and
 * mean the same cell. Inventing warmer first-person wording here would break
 * that shared vocabulary for nothing. Level 0 has no name in the design
 * vocabulary — it is «не начато», exactly as the admin says.
 *
 * Interpolated strings are functions, not templates with placeholders: Russian
 * needs the day word agreed with the number and Uzbek does not, and a function
 * per language is the only way to keep that inside the dictionary instead of
 * leaking grammar into the renderer.
 */
export type PassportDict = {
  since: (date: string) => string;
  ring_caption: string;
  ring_counts: (done: number, total: number) => string;
  probation: string;
  left: (days: number) => string;
  over: (days: number) => string;
  due_today: string;
  until: (date: string) => string;
  overdue_modules: (n: number) => string;
  modules: string;
  optional: string;
  no_topics: string;
  done: string;
  done_late: string;
  topics_progress: (done: number, total: number) => string;
  /** Index 0..4. 0 is "не начато". */
  level: readonly string[];
  locked: string;
  need_mentor: string;
  current: string;
  stamps: string;
  stamps_empty: string;
  stamp: Record<StampType, string>;
  stamp_valid: (date: string) => string;
  empty_title: string;
  empty_body: string;
  /** Short month names, January first. */
  months: readonly string[];
};

export type Dict = {
  loading_slow: string;
  retry: string;
  status: Record<StatusKey, { title: string; body: string }>;
  passport_title: string;
  passport_body: string;
  mentor_title: string;
  mentor_body: string;
  mentor_signoff_note: string;
  soon: string;
  p: PassportDict;
};

/** «1 день», «2 дня», «5 дней». Russian only; Uzbek has no such agreement. */
function ruDays(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return "дней";
  if (b === 1) return "день";
  if (b >= 2 && b <= 4) return "дня";
  return "дней";
}

const RU: Dict = {
  loading_slow: "Связь медленная. Ждём ответ…",
  retry: "Повторить",
  status: {
    outside_telegram: {
      title: "Откройте через Telegram",
      body: "Приложение работает только внутри Telegram. Отсканируйте QR-код с листа ещё раз или откройте бота @pasport_stajer_bot.",
    },
    no_access: {
      title: "Доступа пока нет",
      body: "Этот Telegram не привязан к стажировке. Попросите у менеджера филиала лист с QR-кодом и отсканируйте его.",
    },
    banned: {
      title: "Доступ закрыт",
      body: "Доступ к паспорту стажёра закрыт. Обратитесь к менеджеру филиала — снять запрет может только офис.",
    },
    wrong_account: {
      title: "QR-код не для этого аккаунта",
      body: "Этот Telegram уже привязан к другому человеку. Войдите со своего аккаунта или попросите менеджера выдать QR-код на вас.",
    },
    expired: {
      title: "Вход устарел",
      body: "Закройте приложение и откройте его заново из Telegram — кнопкой бота или по QR-коду. Обновление страницы не поможет.",
    },
    not_configured: {
      title: "Приложение ещё не настроено",
      body: "Бот паспорта не подключён на сервере. Покажите этот экран менеджеру — это чинит IT, не вы.",
    },
    not_started: {
      title: "Стажировка ещё не начата",
      body: "Вход выполнен, но открытой стажировки нет. Паспорт появится, когда менеджер оформит её в офисе.",
    },
    offline: {
      title: "Нет связи",
      body: "Проверьте интернет — на кухне сеть часто пропадает — и попробуйте ещё раз.",
    },
    unknown: {
      title: "Что-то пошло не так",
      body: "Попробуйте ещё раз. Если экран повторится — покажите его менеджеру филиала.",
    },
  },
  passport_title: "Паспорт стажёра",
  passport_body: "Вход выполнен. Здесь появится ваш путь: модули, темы и сроки.",
  mentor_title: "Режим наставника",
  mentor_body: "Вход выполнен как наставник. Здесь появится очередь стажёров, которые ждут наблюдения.",
  mentor_signoff_note: "Подпись за стажёра ставится в офисной админке, не в этом приложении.",
  soon: "Готовится",
  p: {
    since: (date) => `Стажировка с ${date}`,
    ring_caption: "тем на уровне «Сам»",
    ring_counts: (done, total) => `${done} из ${total}`,
    probation: "Испытательный срок",
    left: (days) => `осталось ${days} ${ruDays(days)}`,
    over: (days) => `просрочено на ${days} ${ruDays(days)}`,
    due_today: "срок сегодня",
    until: (date) => `до ${date}`,
    // Counter-style phrasing on purpose: «Просрочено модулей: 2» needs no
    // agreement between the number, the noun and the verb, so it stays right
    // for 1, 2 and 5 alike.
    overdue_modules: (n) => `Просрочено модулей: ${n}`,
    modules: "Модули",
    optional: "необязательный",
    no_topics: "Темы ещё не добавлены",
    done: "Сдано",
    done_late: "Сдано с опозданием",
    topics_progress: (done, total) => `${done} из ${total} тем`,
    level: ["Не начато", "Увидел", "Сделал", "Сам", "Учит других"],
    locked: "Откроется позже",
    need_mentor: "нужен наставник",
    current: "Ваш шаг",
    stamps: "Штампы",
    stamps_empty: "Пока ни одного. Штамп ставится за сданный модуль.",
    stamp: {
      module_cert: "Модуль сдан",
      universal_chopar: "Универсал Chopar",
      universal_les: "Универсал Les",
      probation_passed: "Испытательный срок пройден",
    },
    stamp_valid: (date) => `действует до ${date}`,
    empty_title: "Программа ещё готовится",
    empty_body:
      "Стажировка открыта, но в вашей программе пока нет опубликованных модулей. Они появятся, когда офис их выпустит.",
    months: [
      "янв",
      "фев",
      "мар",
      "апр",
      "мая",
      "июн",
      "июл",
      "авг",
      "сен",
      "окт",
      "ноя",
      "дек",
    ],
  },
};

const UZ: Dict = {
  loading_slow: "Aloqa sekin. Javobni kutyapmiz…",
  retry: "Qayta urinish",
  status: {
    outside_telegram: {
      title: "Telegram orqali oching",
      body: "Ilova faqat Telegram ichida ishlaydi. Qogʻozdagi QR-kodni qaytadan skanerlang yoki @pasport_stajer_bot botini oching.",
    },
    no_access: {
      title: "Hozircha ruxsat yoʻq",
      body: "Bu Telegram stajirovkaga bogʻlanmagan. Filial menejeridan QR-kodli varaqni soʻrang va uni skanerlang.",
    },
    banned: {
      title: "Ruxsat yopilgan",
      body: "Stajyor pasportiga ruxsatingiz yopilgan. Filial menejeriga murojaat qiling — taqiqni faqat ofis olib tashlaydi.",
    },
    wrong_account: {
      title: "Bu QR-kod sizniki emas",
      body: "Bu Telegram boshqa odamga bogʻlangan. Oʻz akkauntingizdan kiring yoki menejerdan oʻzingizga QR-kod soʻrang.",
    },
    expired: {
      title: "Kirish eskirdi",
      body: "Ilovani yoping va Telegramdan qaytadan oching — bot tugmasi yoki QR-kod orqali. Sahifani yangilash yordam bermaydi.",
    },
    not_configured: {
      title: "Ilova hali sozlanmagan",
      body: "Serverda pasport boti ulanmagan. Bu ekranni menejerga koʻrsating — buni IT tuzatadi, siz emas.",
    },
    not_started: {
      title: "Stajirovka hali boshlanmagan",
      body: "Kirdingiz, lekin ochiq stajirovka yoʻq. Menejer uni ofisda rasmiylashtirgach, pasport paydo boʻladi.",
    },
    offline: {
      title: "Aloqa yoʻq",
      body: "Internetni tekshiring — oshxonada tarmoq tez-tez uziladi — va yana urinib koʻring.",
    },
    unknown: {
      title: "Nimadir notoʻgʻri ketdi",
      body: "Yana urinib koʻring. Ekran takrorlansa — uni filial menejeriga koʻrsating.",
    },
  },
  passport_title: "Stajyor pasporti",
  passport_body: "Kirdingiz. Bu yerda yoʻlingiz koʻrinadi: modullar, mavzular va muddatlar.",
  mentor_title: "Ustoz rejimi",
  mentor_body: "Ustoz sifatida kirdingiz. Bu yerda kuzatuvni kutayotgan stajyorlar navbati koʻrinadi.",
  mentor_signoff_note: "Stajyor uchun imzo ofis admin panelida qoʻyiladi, bu ilovada emas.",
  soon: "Tayyorlanmoqda",
  p: {
    since: (date) => `Stajirovka ${date} dan`,
    ring_caption: "mavzu «Mustaqil» darajasida",
    ring_counts: (done, total) => `${total} tadan ${done} tasi`,
    probation: "Sinov muddati",
    left: (days) => `${days} kun qoldi`,
    over: (days) => `${days} kun kechikdi`,
    due_today: "muddat bugun",
    until: (date) => `${date} gacha`,
    overdue_modules: (n) => `Muddati oʻtgan modullar: ${n}`,
    modules: "Modullar",
    optional: "majburiy emas",
    no_topics: "Mavzular hali qoʻshilmagan",
    done: "Topshirildi",
    done_late: "Kechikib topshirildi",
    topics_progress: (done, total) => `${total} mavzudan ${done} tasi`,
    level: ["Boshlanmagan", "Koʻrdi", "Qildi", "Mustaqil", "Oʻrgatadi"],
    locked: "Keyinroq ochiladi",
    need_mentor: "ustoz kerak",
    current: "Navbat sizda",
    stamps: "Muhrlar",
    stamps_empty: "Hozircha yoʻq. Muhr topshirilgan modul uchun beriladi.",
    stamp: {
      module_cert: "Modul topshirildi",
      universal_chopar: "Chopar universali",
      universal_les: "Les universali",
      probation_passed: "Sinov muddati oʻtildi",
    },
    stamp_valid: (date) => `${date} gacha amal qiladi`,
    empty_title: "Dastur hali tayyorlanmoqda",
    empty_body:
      "Stajirovka ochilgan, lekin dasturingizda hali chop etilgan modullar yoʻq. Ofis ularni chiqargach, shu yerda paydo boʻladi.",
    months: [
      "yan",
      "fev",
      "mar",
      "apr",
      "may",
      "iyn",
      "iyl",
      "avg",
      "sen",
      "okt",
      "noy",
      "dek",
    ],
  },
};

const DICTS: Record<Lang, Dict> = { ru: RU, uz: UZ };

export function t(): Dict {
  return DICTS[current];
}

/**
 * Postgres `timestamptz` arrives from drizzle (mode: "string") as
 * "2026-08-09 17:00:00+05", which is not ISO-8601, while `deadline_at` is
 * computed server-side and IS ISO. Both have to parse, so this mirrors
 * backend/src/modules/passport/deadline.ts: try as-is, then T-normalised.
 */
export function parseTs(value: string | null | undefined): number | null {
  if (!value) return null;
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;
  const fixed = Date.parse(value.replace(" ", "T"));
  return Number.isNaN(fixed) ? null : fixed;
}

/**
 * «3 авг», and «3 авг 2027» once the year stops being obvious. Hand-rolled
 * month names rather than Intl: uz-Latn is missing or wrong on a good share of
 * mid-range Android WebViews, and this is twelve short strings.
 */
export function fmtDate(value: string | null | undefined): string {
  const ms = parseTs(value);
  if (ms === null) return "";
  const d = new Date(ms);
  const month = t().p.months[d.getMonth()] ?? "";
  const year =
    d.getFullYear() === new Date().getFullYear() ? "" : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${month}${year}`;
}
