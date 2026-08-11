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
};

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
};

const DICTS: Record<Lang, Dict> = { ru: RU, uz: UZ };

export function t(): Dict {
  return DICTS[current];
}
