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
  /** Past the deadline by less than a day: «просрочено на 0 дней» is not a thing. */
  over_today: string;
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
  /** Fallback for a stamp type this build does not know. */
  stamp_other: string;
  stamp_valid: (date: string) => string;
  empty_title: string;
  empty_body: string;
  /** Short month names, January first. */
  months: readonly string[];
};

/**
 * The topic screen (C3). TWI wording — «шаг», «ключевой момент», «почему» — is
 * the vocabulary the paper training sheets already use, so the app names the
 * three blocks the way a trainer names them out loud.
 *
 * `video_note` is the honest half of the video slot. `passport_topics.video_id`
 * exists and the admin API can set it, but NOTHING serves the bytes yet — there
 * is no passport_media route anywhere in backend/src, and the X-Accel location
 * belongs to a later stage. So a topic that HAS a video says so in one muted
 * line instead of drawing a player that would never load.
 */
export type TopicDict = {
  back: string;
  step: string;
  key_point: string;
  reason: string;
  no_material: string;
  video_note: string;
  start_quiz: string;
  /** Stated BEFORE the quiz opens: it is taken alone, and why that is fair. */
  quiz_hint: string;
  passed_chip: string;
  mentor_next_title: string;
  mentor_next_body: string;
  call_mentor: string;
  observation_only_title: string;
  observation_only_body: string;
  done_title: string;
  done_body: string;
  to_passport: string;
  /** The screen a trainee holds up to a mentor. */
  mentor_title: string;
  mentor_body: string;
  mentor_what: string;
  mentor_topic: string;
};

/** Every non-2xx the quiz routes can answer, as its own human situation. */
export type QuizErrKey =
  | "already_passed"
  | "no_quiz"
  | "no_questions"
  | "test_gone"
  | "topic_gone"
  | "attempt_gone"
  | "finalized";

export type QuizDict = {
  title: string;
  leave: string;
  leave_title: string;
  leave_body: string;
  leave_confirm: string;
  leave_cancel: string;
  progress: (index: number, total: number) => string;
  single_hint: string;
  multi_hint: string;
  next: string;
  prev: string;
  review: string;
  /** Header countdown; only rendered when the test carries a time limit. */
  clock: (minutes: number) => string;
  time_over: string;
  confirm_title: string;
  confirm_body: string;
  /** The cooldown rule, said BEFORE the tap that can trigger it. */
  confirm_rule: string;
  answered: (done: number, total: number) => string;
  unanswered: (n: number) => string;
  send: string;
  sending: string;
  back_to_questions: string;
  passed_title: string;
  failed_title: string;
  expired_title: string;
  /** Both numbers come from the server: its score and its own threshold. */
  score: (score: number) => string;
  need: (score: number) => string;
  passed_body_mentor: string;
  passed_body_solo: string;
  failed_body: string;
  expired_body: string;
  retry: string;
  to_topic: string;
  cooldown_title: (minutes: number) => string;
  cooldown_body: string;
  send_failed_title: string;
  send_failed_body: string;
  send_again: string;
  err: Record<QuizErrKey, { title: string; body: string }>;
};

export type Dict = {
  // NOTE: there is deliberately no `loading_slow` here. The slow-network line
  // must render when the bundle has not run at all (telegram.org unreachable),
  // so it lives as static markup in index.html and is revealed by CSS. Keeping
  // a copy in this file would be dead code that silently fails to take effect
  // when someone edits it. Change that text in index.html.
  retry: string;
  status: Record<StatusKey, { title: string; body: string }>;
  passport_title: string;
  passport_body: string;
  mentor_title: string;
  mentor_body: string;
  mentor_signoff_note: string;
  soon: string;
  p: PassportDict;
  tp: TopicDict;
  q: QuizDict;
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

/**
 * Minutes after «через», which is the only place this app counts them: the
 * cooldown line. Its own helper for two reasons — the noun is feminine, so
 * ruDays would print «1 минут», and «через» takes the ACCUSATIVE, so even the
 * nominative «1 минута» would be wrong here. 1 «минуту», 2–4 «минуты», the
 * rest «минут».
 */
function ruMinutesAfterVia(n: number): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return "минут";
  if (b === 1) return "минуту";
  if (b >= 2 && b <= 4) return "минуты";
  return "минут";
}

const RU: Dict = {
  retry: "Повторить",
  status: {
    // TWO causes, one screen, and the second half is not optional.
    //
    // We get here whenever initData is empty, and that happens both when the
    // page was opened outside Telegram AND when telegram-web-app.js could not
    // be fetched -- a person who IS inside Telegram, on branch wifi. Telling
    // them only to rescan sends them to rescan, fail, and call the manager.
    outside_telegram: {
      title: "Откройте через Telegram",
      body: "Приложение работает только внутри Telegram — отсканируйте QR-код с листа или откройте бота @pasport_stajer_bot. Если вы уже открыли его из Telegram, значит нет связи: проверьте интернет и откройте приложение заново.",
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
    over_today: "срок вышел",
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
    stamp_other: "Штамп",
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
  tp: {
    back: "Назад",
    step: "Шаг",
    key_point: "Ключевой момент",
    reason: "Почему так",
    no_material: "Материал к этой теме ещё не заполнен. Спросите наставника — он покажет на месте.",
    video_note: "Видео к этой теме пока не открывается в приложении — его показывает наставник.",
    start_quiz: "Сдать квиз",
    // Said before the quiz opens, not after. The trainee is about to be alone
    // with it on purpose, and knowing that the practical half is signed by
    // someone else is what makes the rule read as fair rather than as suspicion.
    quiz_hint: "Квиз проходят одни, без подсказок. Практику принимает наставник отдельно.",
    passed_chip: "Квиз сдан",
    mentor_next_title: "Дальше — наставник",
    mentor_next_body: "Квиз сдан. Осталось показать на смене, как вы это делаете.",
    call_mentor: "Позвать наставника",
    observation_only_title: "Эту тему принимает наставник",
    observation_only_body: "Квиза здесь нет: наставник смотрит, как вы это делаете, и ставит отметку.",
    done_title: "Тема закрыта",
    done_body: "Уровень «Сам». Возвращайтесь сюда, когда нужно освежить материал.",
    to_passport: "К паспорту",
    mentor_title: "Позовите наставника",
    // The app sends nothing anywhere. Saying so plainly is the difference
    // between a person waiting for a mentor who was never called and a person
    // who goes and finds one.
    mentor_body: "Приложение никого не вызывает — подойдите к наставнику сами и покажите этот экран.",
    mentor_what: "Наставник смотрит, как вы делаете это на смене.",
    mentor_topic: "Тема",
  },
  q: {
    title: "Квиз",
    leave: "Выйти",
    leave_title: "Выйти из квиза?",
    leave_body: "Ответы на этом телефоне не сохранятся, но попытка останется открытой — вы вернётесь к тем же вопросам.",
    leave_confirm: "Выйти",
    leave_cancel: "Остаться",
    progress: (index, total) => `Вопрос ${index} из ${total}`,
    single_hint: "Один ответ",
    multi_hint: "Можно выбрать несколько",
    next: "Далее",
    prev: "Назад",
    review: "Проверить ответы",
    clock: (minutes) => `${minutes} мин`,
    time_over: "Время вышло",
    confirm_title: "Отправить ответы?",
    confirm_body: "После отправки изменить ответы нельзя.",
    confirm_rule: "Если не сдать два раза подряд, квиз откроется только через час.",
    answered: (done, total) => `Отвечено ${done} из ${total}`,
    unanswered: (n) => `Без ответа: ${n}`,
    send: "Отправить",
    sending: "Отправляем…",
    back_to_questions: "Вернуться к вопросам",
    passed_title: "Квиз сдан",
    failed_title: "Пока не сдано",
    expired_title: "Время вышло",
    score: (score) => `${score} из 100`,
    need: (score) => `нужно ${score}`,
    passed_body_mentor: "Дальше наставник смотрит вас на смене.",
    passed_body_solo: "Тема закрыта на уровне «Сам».",
    failed_body: "Перечитайте ключевой момент в теме и попробуйте ещё раз.",
    expired_body: "Ответы ушли позже отведённого времени, поэтому не засчитаны.",
    retry: "Пройти ещё раз",
    to_topic: "Вернуться к теме",
    cooldown_title: (minutes) =>
      `Откроется через ${minutes} ${ruMinutesAfterVia(minutes)}`,
    cooldown_body: "Два раза подряд не сдано, поэтому квиз закрыт на час. Это время на повторение материала — так ответы не подбираются наугад.",
    send_failed_title: "Ответы не ушли",
    send_failed_body: "Связь пропала. Ответы никуда не делись — они на этом телефоне. Попробуйте отправить ещё раз.",
    send_again: "Отправить ещё раз",
    err: {
      already_passed: {
        title: "Квиз уже сдан",
        body: "Эта тема уже пройдена — сдавать заново не нужно.",
      },
      no_quiz: {
        title: "У этой темы нет квиза",
        body: "Тему принимает наставник: он смотрит, как вы это делаете, и ставит отметку.",
      },
      no_questions: {
        title: "Квиз ещё не готов",
        body: "В квизе нет вопросов. Покажите этот экран менеджеру — это чинит офис, не вы.",
      },
      test_gone: {
        title: "Квиз недоступен",
        body: "Офис отключил этот квиз. Спросите наставника, что делать дальше.",
      },
      topic_gone: {
        title: "Темы больше нет",
        body: "Офис снял этот модуль. Вернитесь в паспорт — там актуальный список.",
      },
      attempt_gone: {
        title: "Попытка не найдена",
        body: "Эта попытка больше не действует. Откройте квиз заново.",
      },
      finalized: {
        // NOT «там видно, что засчитано»: that is only true when the lost
        // submit passed. A failed one leaves the topic exactly as it was, and
        // the sentence would send someone looking for a change that is not
        // there. What IS always true: the topic shows the current state, and
        // the quiz is open again if it was not counted.
        title: "Ответы уже приняты",
        body: "Эта попытка закрыта на сервере. Откройте тему — там текущее состояние: если квиз не засчитан, его можно пройти ещё раз.",
      },
    },
  },
};

const UZ: Dict = {
  retry: "Qayta urinish",
  status: {
    outside_telegram: {
      title: "Telegram orqali oching",
      body: "Ilova faqat Telegram ichida ishlaydi — qogʻozdagi QR-kodni skanerlang yoki @pasport_stajer_bot botini oching. Agar uni Telegramdan ochgan boʻlsangiz, demak aloqa yoʻq: internetni tekshiring va ilovani qaytadan oching.",
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
    over_today: "muddat tugadi",
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
    stamp_other: "Muhr",
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
  tp: {
    back: "Orqaga",
    step: "Qadam",
    key_point: "Asosiy nuqta",
    reason: "Nima uchun",
    no_material: "Bu mavzuning materiali hali toʻldirilmagan. Ustozdan soʻrang — u joyida koʻrsatadi.",
    video_note: "Bu mavzuning videosi ilovada hozircha ochilmaydi — uni ustoz koʻrsatadi.",
    start_quiz: "Kvizni topshirish",
    quiz_hint: "Kvizni yolgʻiz, yordamsiz topshirasiz. Amaliyotni ustoz alohida qabul qiladi.",
    passed_chip: "Kviz topshirildi",
    mentor_next_title: "Keyingisi — ustoz",
    mentor_next_body: "Kviz topshirildi. Endi smenada buni qanday bajarishingizni koʻrsatish qoldi.",
    call_mentor: "Ustozni chaqirish",
    observation_only_title: "Bu mavzuni ustoz qabul qiladi",
    observation_only_body: "Bu yerda kviz yoʻq: ustoz buni qanday bajarishingizni koʻradi va belgi qoʻyadi.",
    done_title: "Mavzu yopildi",
    done_body: "«Mustaqil» darajasi. Materialni yangilash kerak boʻlsa, shu yerga qayting.",
    to_passport: "Pasportga",
    mentor_title: "Ustozni chaqiring",
    mentor_body: "Ilova hech kimni chaqirmaydi — ustozning oldiga oʻzingiz boring va shu ekranni koʻrsating.",
    mentor_what: "Ustoz smenada buni qanday bajarishingizni koʻradi.",
    mentor_topic: "Mavzu",
  },
  q: {
    title: "Kviz",
    leave: "Chiqish",
    leave_title: "Kvizdan chiqasizmi?",
    leave_body: "Bu telefondagi javoblar saqlanmaydi, lekin urinish ochiq qoladi — oʻsha savollarga qaytasiz.",
    leave_confirm: "Chiqish",
    leave_cancel: "Qolish",
    progress: (index, total) => `${total} savoldan ${index}-si`,
    single_hint: "Bitta javob",
    multi_hint: "Bir nechtasini tanlash mumkin",
    next: "Keyingisi",
    prev: "Orqaga",
    review: "Javoblarni tekshirish",
    clock: (minutes) => `${minutes} daq`,
    time_over: "Vaqt tugadi",
    confirm_title: "Javoblar yuborilsinmi?",
    confirm_body: "Yuborilgandan keyin javoblarni oʻzgartirib boʻlmaydi.",
    confirm_rule: "Ketma-ket ikki marta topshirilmasa, kviz faqat bir soatdan keyin ochiladi.",
    answered: (done, total) => `${total} tadan ${done} tasiga javob berildi`,
    unanswered: (n) => `Javobsiz: ${n}`,
    send: "Yuborish",
    sending: "Yuborilmoqda…",
    back_to_questions: "Savollarga qaytish",
    passed_title: "Kviz topshirildi",
    failed_title: "Hozircha topshirilmadi",
    expired_title: "Vaqt tugadi",
    score: (score) => `100 dan ${score}`,
    need: (score) => `kerak ${score}`,
    passed_body_mentor: "Endi ustoz sizni smenada kuzatadi.",
    passed_body_solo: "Mavzu «Mustaqil» darajasida yopildi.",
    failed_body: "Mavzudagi asosiy nuqtani qayta oʻqing va yana urinib koʻring.",
    expired_body: "Javoblar belgilangan vaqtdan kechroq yuborildi, shuning uchun hisobga olinmadi.",
    retry: "Yana topshirish",
    to_topic: "Mavzuga qaytish",
    cooldown_title: (minutes) => `${minutes} daqiqadan keyin ochiladi`,
    cooldown_body: "Ketma-ket ikki marta topshirilmadi, shuning uchun kviz bir soatga yopildi. Bu vaqt materialni takrorlash uchun — javoblar tavakkaliga topilmasin.",
    send_failed_title: "Javoblar yuborilmadi",
    send_failed_body: "Aloqa uzildi. Javoblar yoʻqolgani yoʻq — ular shu telefonda. Yana yuborib koʻring.",
    send_again: "Yana yuborish",
    err: {
      already_passed: {
        title: "Kviz allaqachon topshirilgan",
        body: "Bu mavzu oʻtilgan — qayta topshirish shart emas.",
      },
      no_quiz: {
        title: "Bu mavzuda kviz yoʻq",
        body: "Mavzuni ustoz qabul qiladi: u buni qanday bajarishingizni koʻradi va belgi qoʻyadi.",
      },
      no_questions: {
        title: "Kviz hali tayyor emas",
        body: "Kvizda savollar yoʻq. Bu ekranni menejerga koʻrsating — buni ofis tuzatadi, siz emas.",
      },
      test_gone: {
        title: "Kviz mavjud emas",
        body: "Ofis bu kvizni oʻchirib qoʻydi. Ustozdan keyin nima qilishni soʻrang.",
      },
      topic_gone: {
        title: "Bu mavzu endi yoʻq",
        body: "Ofis bu modulni olib tashladi. Pasportga qayting — u yerda joriy roʻyxat bor.",
      },
      attempt_gone: {
        title: "Urinish topilmadi",
        body: "Bu urinish endi amal qilmaydi. Kvizni qaytadan oching.",
      },
      finalized: {
        title: "Javoblar allaqachon qabul qilingan",
        body: "Bu urinish serverda yopilgan. Mavzuni oching — u yerda joriy holat: kviz hisobga olinmagan boʻlsa, uni yana topshirish mumkin.",
      },
    },
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
