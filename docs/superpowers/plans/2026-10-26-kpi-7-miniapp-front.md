# KPI — План 7: мини-приложение «Мой KPI», фронт, админка, деплой

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Клиент `kpi_miniapp/` с главным экраном, разбором оценки, нарушениями, историей и спором; режим разработки с поддельным Telegram для проверки в обычном Chrome; подписи в админке; заметки к деплою; визуальная проверка всех состояний на базе `managers_kpi_smoke`.

**Architecture:** Подход `passport_miniapp`: Vite и TypeScript без фреймворка, один HTML, один CSS, один JS, навигация по `location.hash`, SDK Telegram с `telegram.org` через `defer`, статический скелетон с CSS-подсказкой о плохой связи (урок F1). Логика (маршруты, API, кэш, тексты, форматы, view-модели экранов) — чистые модули с тестами `bun test` в `kpi_miniapp/test/`; экраны только рисуют view-модели. Типы ответов берутся `import type` из `@backend/modules/kpi/tg-app/types` (план 6). В dev-сборке флаг в адресе подставляет поддельный `window.Telegram.WebApp` с `initData`, подписанным тестовым токеном; данные даёт `smoke-seed.ts` на `managers_kpi_smoke`.

**Tech Stack:** Bun 1.4, Vite 7.1, TypeScript 5.9, Telegram WebApp SDK (`telegram-web-app.js`), Next.js 15 (админка), chrome-attach MCP.

**Spec:** `docs/superpowers/specs/2026-10-26-kpi-employee-miniapp-design.md` (разделы 4, 6, 9, 10, 11, 12). Макеты: `docs/superpowers/specs/2026-10-26-kpi-employee-miniapp/home-layout-v3.html`, `screens.html`.

Предыдущие планы: `2026-10-26-kpi-6-miniapp-backend.md` (раздел «Типы ответов» и таблица кодов — контракт этого плана; `signInitData`, `dev-data.ts`), `2026-08-10-trainee-passport-1c-miniapp.md`. Образец кода: `passport_miniapp/` (`index.html`, `src/api.ts`, `src/telegram.ts`, `vite.config.ts`). Уроки раздачи: `docs/superpowers/passport-1c-c5-deploy-spec.md`.

## Global Constraints

- Рабочая копия `/Users/macbookpro/development/managers-kpi`, ветка `feature/kpi`. Каталог `/Users/macbookpro/development/managers` не трогать. Git — через `git -C /Users/macbookpro/development/managers-kpi`.
- Коммитить только свои файлы поимённо. `git add -A` и `git add .` запрещены. Никаких `git push`, ssh, docker, `pm2`, деплоя; nginx и BotFather только описываются в `kpi-deploy.md`.
- Базу с именем `managers` не трогать. Автотесты backend — только на `managers_tickets_test` через `TEST_DATABASE_URL` (как в плане 6). База `managers_kpi_smoke` пишется только стендом задач 3 и 9 (миграции и `smoke-seed.ts`) и только после проверки имени (`case … *managers_kpi_smoke`).
- Dev-backend стенда: `NODE_ENV=development` (иначе `backend/src/index.ts` уходит в ветку кластера и поднимает два процесса на одном порту), `PROJECT_PREFIX=managers_smoke_`, `KPI_NOTIFY_QUEUE=kpi_notify_smoke`, поддельный `KPI_BOT_TOKEN=123456:kpi-smoke-dev-token`, без `KPI_MINIAPP_URL`. Воркер `kpi_worker` и `set-menu.ts` против стенда не запускать. Тестовый токен backend принимает только под префиксами `managers_test_` и `managers_smoke_` (`tokenAllowed`, план 6, решение 21).
- Runtime — Bun: `bun install`, `bun test`, `bun --bun run build`.
- Регистрация модуля: план не добавляет роутов backend. Роуты KPI монтируются только в `backend/src/modules/kpi/controller.ts` (контроллер `new Elysia({ name: "@api/kpi", prefix: "/api" })`, в `app.ts` как `as unknown as Elysia`). Понадобился новый роут — остановиться и доложить.
- Комментарии в коде по-русски, как в окружающем коде.
- **Скиллы дизайна.** Исполнитель каждой UI-задачи (4, 5, 6, 7 и правок задачи 9) до первой строки HTML, CSS или DOM-кода вызывает инструментом Skill сначала `design-taste-frontend`, потом `frontend-design` и следует им. Каркас раскладки закреплён макетами (порядок блоков и их содержимое), визуальное решение остаётся за исполнителем. Ограничения спеки, раздел 9: тач-цели не меньше 44 px, основной текст не меньше 14 px (подписи шкалы и вторичные пометки — не меньше 12 px), числа с `font-variant-numeric: tabular-nums`, короткие тексты, контраст AA в обеих темах, без горизонтальной прокрутки на 360 px.
- Стек `kpi_miniapp`: без фреймворка и без runtime-зависимостей; devDependencies ровно `typescript ^5.9.3`, `vite ^7.1.14` (как у паспорта). `base: "/kpi-app/"`, `build.target: "es2018"`, `cssCodeSplit: false`, `assetsInlineLimit: 4096`, `sourcemap: false`. Пути API абсолютные: `/api/kpi/tg/...`. `passport_miniapp/` не трогать.
- Типы ответов — только `import type { … } from "@backend/modules/kpi/tg-app/types";` одной строкой. Runtime-импортов из backend в `src/` нет: `grep -rn '@backend' kpi_miniapp/src | grep -v '^[^:]*:[0-9]*:import type .* from "@backend/'` печатает пусто.
- В `bun test` нет DOM. Модули, которые импортируют тесты (всё, кроме `main.ts`, `ui.ts`, `screens/*`, `sheet.ts`, `photo.ts`, `dev/fake-telegram.ts`), обращаются к `window`, `document` и `localStorage` только внутри функций. Тесты не импортируют модули из этого списка; всё, что нужно тестам, живёт в чистых модулях (`disputeErrorText` — в `view/review.ts`, `devRequested`, `DEV_MARKER` и `THEMES` — в `dev/flag.ts`). Общие экземпляры ленивые: `appApi()` в `api.ts` и `appCache()` в `cache.ts` создаются при первом вызове.
- Строки с сервера (имена, заметки, комментарии, причины, названия пунктов) попадают в DOM только текстом: `h()` превращает строковых детей в `createTextNode`. `innerHTML`, `outerHTML` и `insertAdjacentHTML` с данными сервера запрещены. Проверка: `grep -rn 'innerHTML\|outerHTML\|insertAdjacentHTML' kpi_miniapp/src` находит только статическую разметку в `ui.ts`, без подстановок.
- Dev-режим включается только константой сборки `__KPI_DEV__` (решение 1), не `import.meta.env.DEV`: та становится `true` и в `vite build`, если в оболочке `NODE_ENV=development`. `dev/fake-telegram.ts` подключается только через `import()`, статических импортов его нет.
- Токен сессии живёт только в памяти. `localStorage` — только кэш экранов с ключом по Telegram user id. Язык клиент не хранит: он приходит с сервера.
- Узбекский — латиница, `oʻ`/`gʻ` с U+02BB, `eʼtiroz`/`maʼlumot` с U+02BC, без ASCII-апострофа (тест в задаче 2). Пробел внутри чисел и перед `%`, `сум`, `soʻm`, `тыс` — U+00A0.
- Telegram: тема из `themeParams` в CSS-переменные, `BackButton` для «назад», `MainButton` для отправки спора, `HapticFeedback` на успехе и ошибке, `ready()` и `expand()` при старте.
- Админка: строки по-русски прямо в коде; `cd admin && ./node_modules/.bin/tsc --noEmit -p . --incremental false 2>&1 | grep "error TS"` пусто (база 2026-10-26: 0, перемерить в задаче 8); линт своих файлов `ESLINT_USE_FLAT_CONFIG=false ./node_modules/.bin/eslint <файлы>` без `error` и `warning`.
- Проверки `kpi_miniapp`: `cd kpi_miniapp && bun test` — PASS; `bun --bun run build` (это `tsc --noEmit && vite build`) — PASS; в `dist/assets/` ровно один `.js` (с задачи 4 — ещё и ровно один `.css`; в задачах 1–3 CSS ещё нет); `grep -rl __KPI_DEV_FAKE_TELEGRAM__ dist` пусто. Проверка маркера настоящая только потому, что `installFakeTelegram` записывает `DEV_MARKER` в DOM (решение 1): неиспользуемую константу сборка выбросила бы и без всякой защиты.
- Скриншоты и прочие артефакты проверки — в scratchpad сессии исполнителя, не в репозиторий.

## Решения плана

1. **Dev-режим — флаг, а не `dev.html`.** `vite.config.ts` задаёт `define: { __KPI_DEV__: JSON.stringify(command === "serve") }` (конфиг — функция от `{ command }`), так что ни один `vite build` его не включит, что бы ни стояло в `NODE_ENV`. `main.ts` статически импортирует только `devRequested` из `./dev/flag` (без DOM) и в начале `boot()` делает `if (__KPI_DEV__ && devRequested(location.search)) (await import("./dev/fake-telegram")).installFakeTelegram(location.search);`. В сборке ветка мёртвая, и `dev/fake-telegram.ts` в бандл не попадает. `installFakeTelegram` первым делом пишет `document.documentElement.dataset.devTelegram = DEV_MARKER`: поэтому маркер `__KPI_DEV_FAKE_TELEGRAM__` в `dist` значит, что подделка уехала в сборку, а его отсутствие что-то доказывает. Утёкшая подделка не обходит вход: подпись `initData` проверяет сервер. Один HTML, и скелетон не расходится между двумя страницами.
2. **SDK с `telegram.org` через `defer`**, как в паспорте, и без `integrity`: Telegram отдаёт меняющийся файл по одному адресу, и закреплённый хеш сломал бы приложение при их обновлении. Спека (4.6) различает «SDK не загрузился» и «вне Telegram». Скелетон и подсказка «Связь плохая, ещё пробуем» — статическая разметка в `index.html`, подсказка проявляется CSS-задержкой 8 с (урок F1). До ответа сервера язык неизвестен, поэтому подсказка и экраны отказа двуязычные: строка RU, под ней строка UZ.
3. **Два отказа старта:** нет `window.Telegram?.WebApp` → `sdk_failed`; объект есть, `initData` пуст → `outside`. Приложение, открытое из чужого бота, получает на входе 401 `bad_init_data`, как при устаревших данных, и показывает экран `expired` («…откройте его из бота снова»): сервер их не различает (спека, раздел 3).
4. **Маршрут** берётся из хеша до первого `?` или `&`: Telegram дописывает к фрагменту свои `tgWebApp…`. `#tgWebAppData=…`, неизвестный путь и кривой месяц → главный экран.
5. **«Назад»:** стек внутри приложения. `BackButton` виден, когда стек глубже главного или открыта шторка. Приложение, открытое ссылкой сразу на `#/review/…`, кладёт главный экран под него, и «назад» ведёт туда.
6. **Проценты** — одна десятичная, запятая, округление половины вверх (`91,7`), как в макетах. Средний на карточке прибавки защищён от перехода ступени: если округление дотягивает до порога, которого точное значение не достигает, берётся округление вниз (`89,96` → `89,9`, а не `90,0` рядом с «150 000»). Баллы пунктов — целые.
7. **Суммы:** группы через U+00A0 (`300 000`); подписи шкалы коротко: `150 тыс` / `150 ming`, от миллиона `1,5 млн` / `1,5 mln`.
8. **Даты и время по Ташкенту** (+5 фиксированно): `10 ноября` / `10-noyabr`; в строке месяцев `с 20.12` / `20.12 dan`; пометка «нет связи» — `14:02`.
9. **Месяцы в строке квартала и в истории:** первый `upcoming` показывает дату начала оценок, следующие — `—`; `pending` — «не оценён» в строке квартала и «ещё не оценён» в истории (спека, 4.4); `not_rated` — «не оценивался». Текущим подсвечивается отчётный месяц: `employee.pending?.period ?? employee.month?.period`.
10. **Короткая карточка неоценённого месяца:** до `submit_opens_at` — «Оценку поставят с 20 ноября», после — «Оценку поставят до 7 декабря» (спека описывает только первый случай).
11. **Подсказка о прибавке** пишет «сум» после каждой суммы (в макетах то с ним, то без).
12. **Нет сети:** кэш по пути запроса; при сбое показывается последний ответ с пометкой времени; без кэша — экран «Нет связи» с «Повторить». Ответ 403 `not_bound`/`inactive` стирает кэш этого пользователя — и на старте, и посреди работы, когда повторный вход после 401 получил 403 (привязку сняли или человека уволили, пока приложение открыто).
18. **Только оценщик.** Если в `roles` нет `employee`, роутер отправляет любой маршрут, кроме главного, на главный экран: `/review`, `/violations` и `/history` ему ответили бы 403 `not_employee`.
13. **Фото** тянутся `fetch` с токеном в blob-URL, URL освобождаются при уходе с экрана. В кэш не попадают: без сети на месте фото — «Фото не загрузилось».
14. **Ссылка оценщика** открывается `Telegram.WebApp.openLink(admin_url)`; `admin_url = null` — ссылки нет.
15. **MainButton спора** активна, только когда в причине не меньше `reason_min` букв или цифр (`/[\p{L}\p{N}]/gu`, как на сервере). На время отправки защёлка и `showProgress`. Успех — `notificationOccurred("success")`, шторка закрывается, экран перезагружается. Ошибка — `notificationOccurred("error")` и текст под полем.
16. **Смена языка:** `PUT /lang`, затем перерисовка текущего экрана с новым `lang` из ответа.
17. **Стенд живёт в реальном времени.** На `managers_kpi_smoke` `KPI_FAKE_NOW` не действует (префикс не `managers_test_`), поэтому `smoke-seed.ts` строит персоны от сегодняшнего отчётного месяца. Если отчётный месяц открывает квартал, состояние «квартал идёт, оценено два месяца» получается только с оценкой будущего месяца. Seed пишет её, хотя в жизни так не бывает: экран при этом честен к данным.

## Review Focus

1. Telegram дописывает параметры запуска к фрагменту: `#/review/2026-10?tgWebAppData=…` или `#tgWebAppData=…`. Наивный роутер открывает пустой экран. Тесты `parseHash` в задаче 1.
2. `telegram.org` недоступен с филиального wifi. Бандл не стартует, пока не кончится запрос SDK, и человек смотрит на немой скелетон. Через 8 с должна появиться подсказка, потом — «Не загрузился Telegram», а не «Откройте из бота». Разметка в задаче 4, проверка в задаче 9.
3. Сессия истекла (12 часов), а приложение открыто. Должен быть один тихий повторный вход, а не цикл и не экран ошибки. Тесты `createApi` в задаче 1.
4. Средний на шкале округлился до порога ступени: «90,0 %» рядом с «Сейчас выходит 150 000». Тест `pct1` с порогами в задаче 2.
5. Двойное нажатие MainButton: второй запрос получает 409 `dispute_exists` и показывает ошибку после успеха. Защёлка `latch()` (тест в задаче 1), применение в задаче 6.

---

## Тексты

Словарь `kpi_miniapp/src/i18n.ts` (`DICT: Record<Lang, Record<Key, string>>`). Подстановки — `{name}`. `{sum}` — `sum()`, `{pct}` — `pct1()`, `{date}` — `dayMonth()`, `{ddmm}` — `ddmm()`, `{time}` — `hhmm()`. `t()` применяет `capFirst` к результату, только если шаблон начинается с `{`: так «{month}dagi…» даёт «Noyabrdagi…», а «предварительно» и «идёт» остаются строчными.

| Ключ | RU | UZ |
|---|---|---|
| `app_title` | Мой KPI | Mening KPI |
| `st_ready` | Оценка готова | Baho tayyor |
| `st_dispute_open` | Спор на рассмотрении | Eʼtiroz koʻrib chiqilmoqda |
| `st_dispute_resolved` | Спор разобран | Eʼtiroz koʻrib chiqildi |
| `st_changed` | Изменена | Oʻzgartirildi |
| `dsp_can` | Оспорить можно до {date}. | {date} gacha eʼtiroz bildirish mumkin. |
| `dsp_open` | Вы оспорили оценку {date}. Ответ придёт в бот. | Siz {date} kuni eʼtiroz bildirdingiz. Javob botga keladi. |
| `dsp_open_violation` | Вы оспорили нарушение {date}. Ответ придёт в бот. | Siz {date} kuni qoidabuzarlikka eʼtiroz bildirdingiz. Javob botga keladi. |
| `dsp_cancelled` | Нарушение отменено, оспаривать нечего. | Qoidabuzarlik bekor qilingan, eʼtiroz kerak emas. |
| `dsp_window_closed` | Срок спора прошёл. | Eʼtiroz muddati oʻtdi. |
| `dsp_period_closed` | Месяц закрыт, оспорить нельзя. | Oy yopilgan, eʼtiroz bildirib boʻlmaydi. |
| `dsp_accepted` | Спор принят | Eʼtiroz qabul qilindi |
| `dsp_rejected` | Спор отклонён | Eʼtiroz rad etildi |
| `lost_title` | Где потеряны баллы | Ballar qayerda yoʻqotildi |
| `lost_none` | Все пункты на максимуме | Barcha bandlar maksimumda |
| `btn_full` | Вся оценка и комментарии | Toʻliq baho va izohlar |
| `pending_title` | {month} ещё не оценён | {month} hali baholanmagan |
| `pending_from` | Оценку поставят с {date}. | Baho {date} dan qoʻyiladi. |
| `pending_until` | Оценку поставят до {date}. | Baho {date} gacha qoʻyiladi. |
| `pending_viol` | Нарушений в {month}: {n} | {month}dagi qoidabuzarliklar: {n} |
| `raise_title` | Прибавка за {quarter} | {quarter}: maosh oshirilishi |
| `badge_prelim` | предварительно | taxminiy |
| `badge_approved` | Утверждено: +{sum} сум | Tasdiqlandi: +{sum} soʻm |
| `badge_no_raise` | Без прибавки | Oshirishsiz |
| `h_none` | Оценок в этом квартале ещё нет. | Bu chorakda hali baho yoʻq. |
| `h_few_1` | Оценён {k} месяц из 3, а прибавку считают от {min}. | 3 oydan {k} tasi baholangan, oshirish esa kamida {min} oy boʻyicha hisoblanadi. |
| `h_few_n` | Оценено {k} месяца из 3, а прибавку считают от {min}. | 3 oydan {k} tasi baholangan, oshirish esa kamida {min} oy boʻyicha hisoblanadi. |
| `h_hold` | Держите уровень {months} — выйдет {sum} сум. | {months} darajasini saqlang — {sum} soʻm chiqadi. |
| `h_hold_zero` | При таком уровне прибавки не будет. | Bu darajada oshirish boʻlmaydi. |
| `h_now` | Сейчас выходит {sum} сум. | Hozir {sum} soʻm chiqmoqda. |
| `h_now_zero` | Пока без прибавки. | Hozircha oshirishsiz. |
| `h_keep` | Сохранится, если в {months} будет от {pct} %. | {months} boʻyicha kamida {pct} % boʻlsa, saqlanadi. |
| `h_next` | Для {sum} сум — в среднем {pct} % за {months}. | {sum} soʻm uchun {months} boʻyicha oʻrtacha {pct} % kerak. |
| `h_next_no` | {sum} сум в этом квартале уже не получится. | Bu chorakda {sum} soʻm endi chiqmaydi. |
| `h_wait` | Ждём решения HR. Предварительно: {sum} сум. | HR qarorini kutyapmiz. Taxminan: {sum} soʻm. |
| `h_wait_zero` | Ждём решения HR. Предварительно: без прибавки. | HR qarorini kutyapmiz. Taxminan: oshirishsiz. |
| `m_pending` | не оценён | baholanmagan |
| `m_upcoming` | с {ddmm} | {ddmm} dan |
| `m_not_rated` | не оценивался | baholanmadi |
| `link_viol` | Нарушения в {month} | {month}dagi qoidabuzarliklar |
| `link_history` | История | Tarix |
| `hist_running` | идёт | davom etmoqda |
| `hist_waiting` | Ждём решения HR | HR qarori kutilmoqda |
| `hist_approved` | Утверждено +{sum} сум | Tasdiqlandi +{sum} soʻm |
| `hist_no_raise` | Без прибавки | Oshirishsiz |
| `hist_pending` | ещё не оценён | hali baholanmagan |
| `hist_avg` | Средний | Oʻrtacha |
| `hist_empty` | Истории пока нет | Hozircha tarix yoʻq |
| `hist_upcoming` | с {date} | {date}dan |
| `grp_base` | Основные пункты | Asosiy bandlar |
| `grp_extra` | Дополнительные пункты | Qoʻshimcha bandlar |
| `src_attendance` | по данным Workly | Workly maʼlumotlari boʻyicha |
| `src_branch` | по баллу филиала | filial bali boʻyicha |
| `no_data` | нет данных | maʼlumot yoʻq |
| `no_data_hint` | Пункт не учтён в итоге: данных за месяц нет. | Band natijaga kirmadi: oy uchun maʼlumot yoʻq. |
| `changes_title` | Изменения | Oʻzgarishlar |
| `change_reason` | Причина: {text} | Sabab: {text} |
| `comment` | Комментарий: {text} | Izoh: {text} |
| `btn_dispute` | Оспорить | Eʼtiroz bildirish |
| `sheet_review` | Оспорить оценку за {month} | {month} bahosiga eʼtiroz |
| `sheet_violation` | Оспорить нарушение | Qoidabuzarlikka eʼtiroz |
| `sheet_hint` | Напишите, с чем не согласны. Ответ придёт в бот. | Nimaga rozi emasligingizni yozing. Javob botga keladi. |
| `sheet_placeholder` | Например: 18 октября у меня был выходной… | Masalan: 18-oktabr kuni dam olish kunim edi… |
| `sheet_min` | Не меньше {min} букв или цифр | Kamida {min} ta harf yoki raqam |
| `sheet_send` | Отправить спор | Eʼtirozni yuborish |
| `err_comment_required` | Слишком коротко: нужно не меньше {min} букв или цифр. | Juda qisqa: kamida {min} ta harf yoki raqam kerak. |
| `err_dispute_window_closed` | Срок спора прошёл. | Eʼtiroz muddati oʻtdi. |
| `err_dispute_exists` | Спор уже открыт. | Eʼtiroz allaqachon ochilgan. |
| `err_period_closed` | Месяц закрыт. | Oy yopilgan. |
| `err_already_cancelled` | Нарушение уже отменено. | Qoidabuzarlik allaqachon bekor qilingan. |
| `err_not_found` | Запись не найдена. | Yozuv topilmadi. |
| `err_generic` | Не получилось. Попробуйте ещё раз. | Xatolik. Yana urinib koʻring. |
| `viol_title` | Нарушения · {month} | Qoidabuzarliklar · {month} |
| `viol_no_item` | Без пункта карты | Kartadan tashqari |
| `viol_active` | действует | kuchda |
| `viol_cancelled` | отменено | bekor qilingan |
| `viol_dispute` | спор открыт | eʼtiroz ochilgan |
| `viol_note` | Нарушение само балл не снижает. Его учитывает оценщик, когда ставит оценку. | Qoidabuzarlik balni oʻzi pasaytirmaydi. Uni baholovchi baho qoʻyishda hisobga oladi. |
| `viol_empty` | Нарушений нет | Qoidabuzarlik yoʻq |
| `photo_failed` | Фото не загрузилось | Rasm yuklanmadi |
| `eval_pending` | Нужно оценить {n} {employees} до {date} | {date} gacha {n} ta xodimni baholash kerak |
| `eval_done` | Все ваши сотрудники оценены | Barcha xodimlaringiz baholangan |
| `eval_link` | Открыть в админке | Admin panelda ochish |
| `no_card` | Для вашей должности KPI пока не настроен | Lavozimingiz uchun KPI hali sozlanmagan |
| `offline_stamp` | Обновлено в {time} — нет связи | {time} da yangilangan — aloqa yoʻq |
| `slow` | Связь плохая, ещё пробуем | Aloqa yomon, yana urinib koʻryapmiz |
| `btn_retry` | Повторить | Qayta urinish |

Экраны отказа (двуязычные, решение 2; `STATUS_TEXT: Record<FailStatus, { ru: string; uz: string }>`):

| Статус | RU | UZ |
|---|---|---|
| `sdk_failed` | Не загрузился Telegram. Обновите или откройте позже | Telegram yuklanmadi. Yangilang yoki keyinroq oching |
| `outside` | Откройте приложение из бота | Ilovani botdan oching |
| `not_bound` | Попросите у HR ссылку-приглашение в бот | HR dan botga taklif havolasini soʻrang |
| `inactive` | Доступ закрыт | Kirish yopilgan |
| `not_configured` | Приложение ещё не настроено на сервере | Ilova serverda hali sozlanmagan |
| `expired` | Сессия устарела. Закройте приложение и откройте его из бота снова | Sessiya eskirdi. Ilovani yoping va botdan qayta oching |
| `offline` | Нет связи. Проверьте интернет и попробуйте снова | Aloqa yoʻq. Internetni tekshiring va qayta urinib koʻring |
| `unknown` | Что-то пошло не так. Попробуйте позже | Nimadir xato ketdi. Keyinroq urinib koʻring |

Месяцы. RU: именительный `январь…декабрь`; родительный `января февраля марта апреля мая июня июля августа сентября октября ноября декабря`; предложный `январе феврале марте апреле мае июне июле августе сентябре октябре ноябре декабре`. UZ: `yanvar fevral mart aprel may iyun iyul avgust sentabr oktabr noyabr dekabr`. Какой падеж куда: `h_hold` — родительный, `h_keep`, `pending_viol`, `link_viol` — предложный, остальные — именительный. Список месяцев: RU через « и », UZ через « va ». `{employees}` — `ruPlural(n, ["сотрудника", "сотрудников", "сотрудников"])`.

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `kpi_miniapp/package.json`, `bun.lock`, `.gitignore`, `tsconfig.json`, `vite.config.ts` | Проект, сборка, прокси `/api` в dev |
| `kpi_miniapp/index.html` | Скелетон, подсказка F1, SDK, точка входа |
| `kpi_miniapp/src/main.ts` | Старт, dev-флаг, роутер, перерисовка |
| `kpi_miniapp/src/telegram.ts` | Типизированная часть SDK, тема, кнопки, хаптика |
| `kpi_miniapp/src/route.ts` | Разбор и сборка хеша |
| `kpi_miniapp/src/api.ts` | Вход, Bearer, один повторный вход, таймаут, фото |
| `kpi_miniapp/src/cache.ts` | Кэш ответов в памяти и `localStorage` |
| `kpi_miniapp/src/util.ts` | `latch`, `capFirst`, `reasonCount` |
| `kpi_miniapp/src/i18n.ts`, `src/format.ts`, `src/hint.ts` | Тексты, форматы, строки подсказки |
| `kpi_miniapp/src/load.ts` | Загрузка экрана: свежие данные, кэш, отказ, медленная связь |
| `kpi_miniapp/src/view/{home,review,violations,history}.ts` | View-модели экранов (чистые) |
| `kpi_miniapp/src/ui.ts`, `src/style.css` | DOM-помощники, экраны отказа, скелетоны, тема |
| `kpi_miniapp/src/screens/{home,review,violations,history}.ts`, `src/sheet.ts`, `src/photo.ts` | Отрисовка экранов, шторка спора, просмотр фото |
| `kpi_miniapp/src/dev/flag.ts` | `devRequested`, `DEV_MARKER`, `THEMES` — без DOM, единственное, что `main.ts` и тесты берут из `dev/` статически |
| `kpi_miniapp/src/dev/fake-telegram.ts` | Поддельный `Telegram.WebApp` (только dev, только через `import()`) |
| `kpi_miniapp/scripts/dev-url.ts` | Ссылка на персону стенда с подписанным `initData` |
| `kpi_miniapp/test/*.test.ts` | Тесты чистых модулей |
| `backend/src/modules/kpi/tg-app/smoke-seed.ts` | Персоны стенда на `managers_kpi_smoke` |
| `admin/app/[locale]/kpi/_components/item-score-row.tsx`, `reviews/_components/review-sheet.tsx`, `violations/new/page.tsx`, `settings/_components/invite-dialog.tsx`, `disputes/page.tsx` (правка) | Подписи раздела 10, источник спора |
| `docs/superpowers/kpi-deploy.md`, `docs/superpowers/kpi-handoff.md` (правка) | Деплой мини-приложения; итоги визуальной проверки |

---

### Task 1: Каркас, маршруты, API-клиент и кэш

**Files:**
- Create: `kpi_miniapp/package.json`, `kpi_miniapp/.gitignore`, `kpi_miniapp/tsconfig.json`, `kpi_miniapp/vite.config.ts`, `kpi_miniapp/index.html` (временный: `<div id="app">`, SDK, `main.ts`), `kpi_miniapp/src/main.ts` (временный: вход и `<pre>` с JSON главного экрана), `src/telegram.ts`, `src/route.ts`, `src/api.ts`, `src/cache.ts`, `src/util.ts`, `kpi_miniapp/test/{route,api,cache,util}.test.ts`, `kpi_miniapp/bun.lock` (генерирует `bun install`)

**Interfaces:**
- Consumes: `TgAuthResponse`, `TgRole`, `TgLang` из `@backend/modules/kpi/tg-app/types` (план 6, раздел «Типы ответов»).
- Produces:
  ```ts
  // src/route.ts
  export type Route = { name: "home" } | { name: "review"; period: string } | { name: "violations"; period: string } | { name: "history" };
  export function parseHash(hash: string): Route;           // period всегда "YYYY-MM-01"
  export function hashOf(r: Route): string;                 // "#/", "#/review/2026-10", "#/violations/2026-10", "#/history"
  // src/api.ts
  export type FailStatus = "sdk_failed" | "outside" | "not_bound" | "inactive" | "not_configured" | "expired" | "offline" | "unknown";
  export type ApiResult<T> = { kind: "ok"; data: T } | { kind: "fail"; status: FailStatus } | { kind: "http"; code: number; error: string | null; body: unknown };
  export interface ApiDeps { fetch: typeof fetch; sdk: () => "ok" | "sdk_failed" | "outside"; initData: () => string; timeoutMs?: number } // по умолчанию 15000
  export function createApi(d: ApiDeps): {
    auth(): Promise<{ kind: "ok"; body: TgAuthResponse } | { kind: "fail"; status: FailStatus }>;
    get<T>(path: string): Promise<ApiResult<T>>;                        // path от "/api/kpi/tg", например "/home"
    send<T>(method: "POST" | "PUT", path: string, body: unknown): Promise<ApiResult<T>>;
    blob(path: string): Promise<Blob | null>;
  };
  export function classifyAuthFailure(status: number, body: unknown): FailStatus;
  export function appApi(): ReturnType<typeof createApi>;  // лениво: window.fetch.bind(window), sdkState, initData
  // src/cache.ts
  export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; key(i: number): string | null; readonly length: number }
  export function createCache(kv: KV | null, owner: number | null): {
    save<T>(path: string, data: T, at: number): void; load<T>(path: string): { data: T; at: number } | null; clear(): void;
  };
  export function appCache(): ReturnType<typeof createCache>; // лениво: localStorage (null при исключении доступа), владелец tgUserId()
  // src/util.ts
  export function latch(): { take(): boolean; release(): void };
  export function capFirst(s: string): string;
  export function reasonCount(s: string): number;           // число букв и цифр, /[\p{L}\p{N}]/gu
  // src/telegram.ts
  export type WebApp = { initData?: string; initDataUnsafe?: { user?: { id?: number } }; colorScheme?: "light" | "dark"; themeParams?: Record<string, string>;
    ready?(): void; expand?(): void; openLink?(url: string): void; onEvent?(e: string, cb: () => void): void;
    BackButton?: { show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
    MainButton?: { setText(t: string): void; show(): void; hide(): void; enable(): void; disable(): void; showProgress(leaveActive?: boolean): void; hideProgress(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
    HapticFeedback?: { notificationOccurred(t: "success" | "error" | "warning"): void } };
  export function webApp(): WebApp | null;
  export function sdkState(): "ok" | "sdk_failed" | "outside";
  export function initData(): string;
  export function tgUserId(): number | null;
  export function applyTheme(): void;   // themeParams → --tg-theme-*; data-scheme="light|dark" на <html>
  export function haptic(kind: "success" | "error"): void;
  ```

Правила `createApi`:
- `auth`: `sdk()` не `ok` → `fail` с этим статусом без запроса; иначе `POST /api/kpi/tg/auth { init_data }`. 200 — токен в замыкании. Иначе `classifyAuthFailure`: 503 → `not_configured`; 401 → `expired`; 403 `not_bound` → `not_bound`, 403 `inactive` → `inactive`; ≥ 500 → `offline`; прочее → `unknown`. Сеть или таймаут → `offline`.
- `get`/`send`/`blob`: без токена сначала `auth`. Заголовок через `new Headers(...)`, как в паспорте. 401 → токен сброшен, один повторный `auth` и повтор запроса; второй 401 → `fail expired`. Повторный `auth` не удался (403 `not_bound`/`inactive`, 503, сеть) → `fail` со статусом этого входа, запрос не повторяется (решение 12). ≥ 500, сеть, таймаут → `fail offline`. Прочие не-2xx → `http` с `error` из тела. 2xx без JSON → `fail unknown`.
- `vite.config.ts`: как у паспорта, но конфиг — функция `defineConfig(({ command }) => ({ … }))`, плюс `define: { __KPI_DEV__: JSON.stringify(command === "serve") }` (решение 1) и `server: { port: 5174, proxy: { "/api": process.env.KPI_DEV_API ?? "http://localhost:6761" } }` (6761 — порт dev-backend в этом репозитории; стенд задачи 3 всегда задаёт `KPI_DEV_API=http://localhost:6799`). `@types/node` в проекте нет (у vite это необязательная зависимость), поэтому в начале файла `declare const process: { env: Record<string, string | undefined> };` — иначе `tsc` падает на «Cannot find name 'process'».
- `tsconfig.json`: как у паспорта плюс `"paths": { "@backend/*": ["../backend/src/*"] }`; `include: ["src", "vite.config.ts"]` — тесты в `test/` в `tsc` не входят.
- `package.json`: `name: "kpi-miniapp"`, скрипты `dev: "vite"`, `build: "tsc --noEmit && vite build"`, `preview: "vite preview"`, `test: "bun test"`.

- [ ] **Step 1: Тесты.** `test/route.test.ts`:

```ts
import { expect, it } from "bun:test";
import { hashOf, parseHash } from "../src/route";

it("parseHash: экраны, параметры Telegram, мусор", () => {
  const H = { name: "home" };
  expect([parseHash(""), parseHash("#"), parseHash("#/")]).toEqual([H, H, H]);
  expect(parseHash("#/review/2026-10")).toEqual({ name: "review", period: "2026-10-01" });
  expect(parseHash("#/review/2026-10?tgWebAppData=abc&tgWebAppVersion=7.10")).toEqual({ name: "review", period: "2026-10-01" });
  expect(parseHash("#/violations/2026-09&tgWebAppData=abc")).toEqual({ name: "violations", period: "2026-09-01" });
  expect(parseHash("#/history")).toEqual({ name: "history" });
  for (const h of ["#tgWebAppData=abc&tgWebAppVersion=7.10", "#/review/2026-13", "#/review/26-10", "#/review/2026-10-01", "#/nope"]) expect(parseHash(h)).toEqual(H);
  expect([hashOf(H as any), hashOf({ name: "review", period: "2026-10-01" }), hashOf({ name: "history" })]).toEqual(["#/", "#/review/2026-10", "#/history"]);
});
```

  `test/api.test.ts` (поддельный `fetch` пишет вызовы и отдаёт ответы по очереди; `const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s })`):

```ts
it("без SDK и вне Telegram — отказ без запроса", async () => {
  const calls: string[] = [];
  const f = (async (u: string) => { calls.push(u); return ok({}); }) as any;
  expect(await createApi({ fetch: f, sdk: () => "sdk_failed", initData: () => "" }).auth()).toEqual({ kind: "fail", status: "sdk_failed" });
  expect(await createApi({ fetch: f, sdk: () => "outside", initData: () => "" }).get("/home")).toEqual({ kind: "fail", status: "outside" });
  expect(calls).toEqual([]);
});
it("401 на запросе: один повторный вход и повтор; второй 401 — expired", async () => {
  const calls: { url: string; auth: string | null }[] = [];
  const replies = [ok({ token: "t1", roles: ["employee"], lang: "ru" }), ok({ error: "unauthorized" }, 401),
    ok({ token: "t2", roles: ["employee"], lang: "ru" }), ok({ x: 1 })];
  const f = (async (url: string, init: RequestInit = {}) => { calls.push({ url, auth: new Headers(init.headers).get("Authorization") }); return replies.shift()!; }) as any;
  const a = createApi({ fetch: f, sdk: () => "ok", initData: () => "q=1" });
  expect(await a.get("/home")).toEqual({ kind: "ok", data: { x: 1 } });
  expect(calls.map((c) => [c.url, c.auth])).toEqual([["/api/kpi/tg/auth", null], ["/api/kpi/tg/home", "Bearer t1"], ["/api/kpi/tg/auth", null], ["/api/kpi/tg/home", "Bearer t2"]]);
  replies.push(ok({ error: "unauthorized" }, 401), ok({ token: "t3", roles: [], lang: "ru" }), ok({ error: "unauthorized" }, 401));
  expect(await a.get("/home")).toEqual({ kind: "fail", status: "expired" });
});
it("повторный вход после 401 получил 403 — fail с его статусом, запрос не повторяется", async () => {
  for (const code of ["inactive", "not_bound"] as const) {
    const calls: string[] = [];
    const r = [ok({ token: "t1", roles: ["employee"], lang: "ru" }), ok({ error: "unauthorized" }, 401), ok({ error: code }, 403)];
    const f = (async (url: string) => { calls.push(url); return r.shift()!; }) as any;
    expect(await createApi({ fetch: f, sdk: () => "ok", initData: () => "q" }).get("/home")).toEqual({ kind: "fail", status: code });
    expect(calls).toEqual(["/api/kpi/tg/auth", "/api/kpi/tg/home", "/api/kpi/tg/auth"]);
  }
});
it("коды входа и сеть", () => {
  expect([classifyAuthFailure(503, { error: "not_configured" }), classifyAuthFailure(401, { error: "bad_init_data" }),
    classifyAuthFailure(403, { error: "not_bound" }), classifyAuthFailure(403, { error: "inactive" }), classifyAuthFailure(502, null), classifyAuthFailure(418, null)])
    .toEqual(["not_configured", "expired", "not_bound", "inactive", "offline", "unknown"]);
});
it("сеть упала и таймаут — offline; 404 с телом — http", async () => {
  const down = (async () => { throw new TypeError("Failed to fetch"); }) as any;
  expect(await createApi({ fetch: down, sdk: () => "ok", initData: () => "q" }).auth()).toEqual({ kind: "fail", status: "offline" });
  const hang = ((_u: string, i: RequestInit) => new Promise((_, rej) => i.signal?.addEventListener("abort", () => rej(new Error("abort"))))) as any;
  expect(await createApi({ fetch: hang, sdk: () => "ok", initData: () => "q", timeoutMs: 20 }).auth()).toEqual({ kind: "fail", status: "offline" });
  const r = [ok({ token: "t", roles: ["employee"], lang: "ru" }), ok({ error: "not_found" }, 404)];
  const f = (async () => r.shift()!) as any;
  expect(await createApi({ fetch: f, sdk: () => "ok", initData: () => "q" }).get("/review?period=2026-10-01"))
    .toEqual({ kind: "http", code: 404, error: "not_found", body: { error: "not_found" } });
});
```

  `test/cache.test.ts`:

```ts
const memKV = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v),
  removeItem: (k: string) => void m.delete(k), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; }, m }; };
it("ключи по владельцу; clear стирает только своё; без kv и при сбое записи — память", () => {
  const kv = memKV();
  const a = createCache(kv, 1); const b = createCache(kv, 2);
  a.save("/home", { n: 1 }, 100); b.save("/home", { n: 2 }, 200);
  expect([...kv.m.keys()].sort()).toEqual(["kpi_app:v1:1:/home", "kpi_app:v1:2:/home"]);
  expect(createCache(kv, 1).load("/home")).toEqual({ data: { n: 1 }, at: 100 });
  a.clear();
  expect([createCache(kv, 1).load("/home"), createCache(kv, 2).load("/home")]).toEqual([null, { data: { n: 2 }, at: 200 }]);
  const broken = { ...memKV(), setItem: () => { throw new Error("quota"); } };
  const c = createCache(broken, 3);
  c.save("/x", 5, 1);
  expect(c.load("/x")).toEqual({ data: 5, at: 1 });
  const d = createCache(null, null); d.save("/y", 6, 2);
  expect(d.load("/y")).toEqual({ data: 6, at: 2 });
});
```

  `test/util.test.ts`: `latch` — `take()` true, повтор false, после `release()` снова true; `capFirst("noyabrdagi")` → `"Noyabrdagi"`, `capFirst("")` → `""`; `reasonCount("  ок!! ")` → `2`, `reasonCount("18 окт")` → `5`.

- [ ] **Step 2: Run** `cd kpi_miniapp && bun install && bun test` — Expected: FAIL (модулей нет). `bun install` создаёт `bun.lock`.
- [ ] **Step 3: Реализовать** модули, конфиги, временные `index.html` и `main.ts` (вход, `GET /home`, вывод JSON в `<pre>`).
- [ ] **Step 4: Run** `bun test` — PASS; `bun --bun run build` — PASS, в `dist/assets/` один `.js`; проверка runtime-импортов из Global Constraints — пусто.
- [ ] **Step 5: Commit**

```bash
git -C /Users/macbookpro/development/managers-kpi add kpi_miniapp/package.json kpi_miniapp/bun.lock kpi_miniapp/.gitignore kpi_miniapp/tsconfig.json kpi_miniapp/vite.config.ts kpi_miniapp/index.html kpi_miniapp/src/main.ts kpi_miniapp/src/telegram.ts kpi_miniapp/src/route.ts kpi_miniapp/src/api.ts kpi_miniapp/src/cache.ts kpi_miniapp/src/util.ts kpi_miniapp/test/route.test.ts kpi_miniapp/test/api.test.ts kpi_miniapp/test/cache.test.ts kpi_miniapp/test/util.test.ts
git -C /Users/macbookpro/development/managers-kpi commit -m "feat(kpi-app): каркас мини-приложения, маршруты, API-клиент и кэш"
```

---

### Task 2: Тексты, форматы и строки подсказки

**Files:**
- Create: `kpi_miniapp/src/i18n.ts`, `src/format.ts`, `src/hint.ts`, `kpi_miniapp/test/{i18n,format,hint}.test.ts`

**Interfaces:**
- Consumes: `TgRaiseHint`, `TgLang` (план 6); `capFirst` (задача 1).
- Produces:
  ```ts
  // src/i18n.ts
  export type Lang = "ru" | "uz";
  export type Key = /* ключи таблицы «Тексты» */;
  export const DICT: Record<Lang, Record<Key, string>>;
  export const STATUS_TEXT: Record<FailStatus, { ru: string; uz: string }>;
  export function setLang(l: Lang): void; export function lang(): Lang;
  export function t(key: Key, vars?: Record<string, string | number>): string;
  export function monthName(period: string, form: "nom" | "gen" | "prep", l: Lang): string;   // строчными
  export function monthsList(periods: string[], form: "nom" | "gen" | "prep", l: Lang): string;
  export function quarterTitle(q: string, l: Lang, withYear?: boolean): string; // "IV квартал" / "IV chorak"; с годом "IV квартал 2026" / "2026-yil IV chorak"
  export function ruPlural(n: number, forms: [string, string, string]): string;
  // src/format.ts
  export function pct1(n: number, guard?: number[]): string;      // без знака %
  export function sum(n: number): string;
  export function sumShort(n: number, l: Lang): string;
  export function dayMonth(iso: string, l: Lang): string;
  export function ddmm(iso: string): string;
  export function hhmm(ms: number): string;
  export function initials(first: string, last: string): string;
  export function trackPos(avg: number, mins: number[]): number;  // 0..1, n ступеней → n + 1 равных отрезков
  // src/hint.ts
  export function hintLines(h: TgRaiseHint, l: Lang): string[];
  export function raiseBadge(h: TgRaiseHint, l: Lang): { text: string; tone: "prelim" | "ok" | "muted" };
  ```

Правила:
- `pct1`: половина вверх до 0,1 через `toPrecision(12)`, как `round2` backend; если для какого-то `t` из `guard` выполнено `n < t` и результат `≥ t` — округление вниз. Всегда одна цифра после запятой.
- `trackPos`: отрезок 0 — `[mins[0] − 10, mins[0])`, отрезок `k` (1…n−1) — `[mins[k−1], mins[k])`, отрезок `n` — `[mins[n−1], 100]`; позиция `(k + clamp01((avg − start) / (end − start))) / (n + 1)`.
- `hintLines`: `decided` → `[]`; `none` → `[h_none]`; `waiting_hr` → `[h_wait]` или `[h_wait_zero]`; `too_few` → `[h_few_1 | h_few_n, amount > 0 ? h_hold (месяцы keep_periods, родительный) : h_hold_zero, ...next]`; `running` → `[amount > 0 ? h_now : h_now_zero, ...(keep ? [h_keep] : []), ...next]`; `next` reachable → `h_next` (месяцы в именительном), unreachable → `h_next_no`. Заглавную букву даёт `t()`.
- `raiseBadge`: `decided` с суммой → `{ badge_approved, "ok" }`, `decided` 0 → `{ badge_no_raise, "muted" }`, прочее → `{ badge_prelim, "prelim" }`.

- [ ] **Step 1: Тесты.** `test/hint.test.ts` (во всех тестах этого плана `const nb = "\u00a0"`):

```ts
const EX1: TgRaiseHint = { kind: "too_few", scored: 1, min_months: 2, keep_periods: ["2026-10-01"], amount: 300000,
  next: { amount: 500000, reachable: true, need_pct: 97.4, periods: ["2026-11-01", "2026-12-01"] } };
const EX2: TgRaiseHint = { kind: "running", amount: 300000, keep: { need_pct: 86.7, periods: ["2026-12-01"] }, next: { amount: 500000, reachable: false } };

it("макет 1 и макет 2 по-русски", () => {
  expect(hintLines(EX1, "ru")).toEqual(["Оценён 1 месяц из 3, а прибавку считают от 2.",
    `Держите уровень октября — выйдет 300${nb}000${nb}сум.`, `Для 500${nb}000${nb}сум — в среднем 97,4${nb}% за ноябрь и декабрь.`]);
  expect(hintLines(EX2, "ru")).toEqual([`Сейчас выходит 300${nb}000${nb}сум.`, `Сохранится, если в декабре будет от 86,7${nb}%.`,
    `500${nb}000${nb}сум в этом квартале уже не получится.`]);
});
it("макеты по-узбекски", () => {
  expect(hintLines(EX1, "uz")).toEqual(["3 oydan 1 tasi baholangan, oshirish esa kamida 2 oy boʻyicha hisoblanadi.",
    `Oktabr darajasini saqlang — 300${nb}000${nb}soʻm chiqadi.`, `500${nb}000${nb}soʻm uchun noyabr va dekabr boʻyicha oʻrtacha 97,4${nb}% kerak.`]);
  expect(hintLines(EX2, "uz")).toEqual([`Hozir 300${nb}000${nb}soʻm chiqmoqda.`, `Dekabr boʻyicha kamida 86,7${nb}% boʻlsa, saqlanadi.`,
    `Bu chorakda 500${nb}000${nb}soʻm endi chiqmaydi.`]);
});
it("прочие ветки", () => {
  expect(hintLines({ kind: "none" }, "ru")).toEqual(["Оценок в этом квартале ещё нет."]);
  expect(hintLines({ kind: "too_few", scored: 2, min_months: 3, keep_periods: ["2026-10-01", "2026-11-01"], amount: 0, next: null }, "ru"))
    .toEqual(["Оценено 2 месяца из 3, а прибавку считают от 3.", "При таком уровне прибавки не будет."]);
  expect(hintLines({ kind: "running", amount: 0, keep: null, next: null }, "uz")).toEqual(["Hozircha oshirishsiz."]);
  expect(hintLines({ kind: "waiting_hr", amount: 0 }, "ru")).toEqual(["Ждём решения HR. Предварительно: без прибавки."]);
  expect(hintLines({ kind: "waiting_hr", amount: 150000 }, "uz")).toEqual([`HR qarorini kutyapmiz. Taxminan: 150${nb}000${nb}soʻm.`]);
  expect(hintLines({ kind: "decided", amount: 500000 }, "ru")).toEqual([]);
  expect([raiseBadge({ kind: "decided", amount: 500000 }, "ru"), raiseBadge({ kind: "decided", amount: 0 }, "uz"), raiseBadge(EX1, "ru")])
    .toEqual([{ text: `Утверждено: +500${nb}000${nb}сум`, tone: "ok" }, { text: "Oshirishsiz", tone: "muted" }, { text: "предварительно", tone: "prelim" }]);
});
```

  `test/format.test.ts`:

```ts
it("pct1 и защита порога", () => {
  expect([pct1(91.65), pct1(90.3), pct1(93), pct1(100), pct1(89.96)]).toEqual(["91,7", "90,3", "93,0", "100,0", "90,0"]);
  expect([pct1(89.96, [85, 90, 95]), pct1(94.96, [85, 90, 95]), pct1(90, [85, 90, 95]), pct1(91.65, [85, 90, 95])]).toEqual(["89,9", "94,9", "90,0", "91,7"]);
});
it("суммы, даты по Ташкенту, инициалы, шкала", () => {
  expect([sum(300000), sum(0), sum(1500000)]).toEqual([`300${nb}000`, "0", `1${nb}500${nb}000`]);
  expect([sumShort(150000, "ru"), sumShort(150500, "ru"), sumShort(1500000, "uz"), sumShort(900, "ru")]).toEqual([`150${nb}тыс`, `150,5${nb}тыс`, `1,5${nb}mln`, "900"]);
  expect([dayMonth("2026-11-10T18:59:59.999Z", "ru"), dayMonth("2026-11-10T18:59:59.999Z", "uz"), dayMonth("2026-11-19T19:00:00.000Z", "ru")])
    .toEqual(["10 ноября", "10-noyabr", "20 ноября"]);
  expect([ddmm("2026-12-19T19:00:00.000Z"), hhmm(Date.UTC(2026, 9, 26, 9, 2))]).toEqual(["20.12", "14:02"]);
  expect(initials("Тест", "Повар")).toBe("ТП");
  expect(trackPos(90.3, [85, 90, 95])).toBeCloseTo(0.515, 6);
  expect([trackPos(80, [85, 90, 95]), trackPos(100, [85, 90, 95]), trackPos(60, [85, 90, 95])]).toEqual([0.125, 1, 0]);
});
```

  `test/i18n.test.ts`: `monthName("2026-10-01", "gen", "ru")` → `"октября"`, `"prep"` → `"октябре"`, uz → `"oktabr"`; `monthsList(["2026-11-01", "2026-12-01"], "nom", "ru")` → `"ноябрь и декабрь"`, uz → `"noyabr va dekabr"`; `quarterTitle("2026-10-01", "ru")` → `"IV квартал"`, `quarterTitle("2026-10-01", "uz", true)` → `"2026-yil IV chorak"`; `ruPlural` на `[1, 2, 5, 11, 21]` с формами `сотрудника/сотрудников/сотрудников`; у `DICT.ru` и `DICT.uz` одинаковые ключи; ни одно значение `DICT.uz` и `STATUS_TEXT[*].uz` не содержит `/['`’]/`; `t("pending_viol", { month: "noyabr", n: 2 })` при `lang() === "uz"` → `"Noyabrdagi qoidabuzarliklar: 2"`.

- [ ] **Step 2: Run** `bun test` — Expected: FAIL.
- [ ] **Step 3: Реализовать** `i18n.ts` (таблица «Тексты» дословно), `format.ts`, `hint.ts`.
- [ ] **Step 4: Run** `bun test` и `bun --bun run build` — PASS.
- [ ] **Step 5: Commit**

```bash
git -C /Users/macbookpro/development/managers-kpi add kpi_miniapp/src/i18n.ts kpi_miniapp/src/format.ts kpi_miniapp/src/hint.ts kpi_miniapp/test/i18n.test.ts kpi_miniapp/test/format.test.ts kpi_miniapp/test/hint.test.ts
git -C /Users/macbookpro/development/managers-kpi commit -m "feat(kpi-app): тексты RU/UZ, форматы чисел и дат, строки подсказки о прибавке"
```

---

### Task 3: Режим разработки и стенд на `managers_kpi_smoke`

**Files:**
- Create: `kpi_miniapp/src/dev/flag.ts`, `kpi_miniapp/src/dev/fake-telegram.ts`, `kpi_miniapp/scripts/dev-url.ts`, `kpi_miniapp/test/dev.test.ts`, `backend/src/modules/kpi/tg-app/smoke-seed.ts`
- Modify: `kpi_miniapp/src/main.ts`

**Interfaces:**
- Consumes: `signInitData` (план 6, задача 3); `seedReview`, `seedViolation`, `seedDispute`, `seedDecision` (план 6, задача 4); `seedCards`, `loadSettings`, `currentReviewPeriod`, `quarterStart`, `addMonths`; `__KPI_DEV__` из `define` в `vite.config.ts` (задача 1).
- Produces:
  ```ts
  // src/dev/flag.ts — без DOM и без обращений к window на верхнем уровне; его импортируют main.ts и dev.test.ts
  export const DEV_MARKER = "__KPI_DEV_FAKE_TELEGRAM__";
  export const THEMES: Record<"light" | "dark", Record<string, string>>;
  export function devRequested(search: string): boolean;   // есть init=, sdk=fail или noinit=1
  // src/dev/fake-telegram.ts — только через import() из main.ts
  export function installFakeTelegram(search: string): void; // первым делом document.documentElement.dataset.devTelegram = DEV_MARKER
  // scripts/dev-url.ts:  KPI_BOT_TOKEN=123456:kpi-… bun scripts/dev-url.ts --tg <id> [--theme light|dark] [--route /review/2026-10] [--port 5174] | --all
  // smoke-seed.ts:       DATABASE_URL=…/managers_kpi_smoke … bun run src/modules/kpi/tg-app/smoke-seed.ts
  ```

Поддельный WebApp (`installFakeTelegram`):
- Первая строка — `document.documentElement.dataset.devTelegram = DEV_MARKER` (решение 1): без неё проверка `dist` на маркер ничего бы не ловила.
- `?sdk=fail` — удаляет `window.Telegram`. `?noinit=1` — `initData = ""`. Иначе `initData` из `?init=`, `initDataUnsafe.user.id` из его поля `user`.
- `colorScheme` и `themeParams` из `?theme=` (по умолчанию `light`):
  - `light`: `bg_color #ffffff`, `secondary_bg_color #f0f0f0`, `text_color #000000`, `hint_color #999999`, `link_color #2481cc`, `button_color #2481cc`, `button_text_color #ffffff`, `header_bg_color #ffffff`, `accent_text_color #2481cc`, `section_bg_color #ffffff`, `section_header_text_color #6d6d71`, `subtitle_text_color #999999`, `destructive_text_color #e53935`;
  - `dark`: `bg_color #212121`, `secondary_bg_color #0f0f0f`, `text_color #ffffff`, `hint_color #aaaaaa`, `link_color #8774e1`, `button_color #8774e1`, `button_text_color #ffffff`, `header_bg_color #212121`, `accent_text_color #8774e1`, `section_bg_color #212121`, `section_header_text_color #8774e1`, `subtitle_text_color #aaaaaa`, `destructive_text_color #ee686f`.
- `BackButton` и `MainButton` рисуются настоящими DOM-кнопками: шапка 48 px сверху с «‹» (`data-dev="back"`, видна после `show()`), кнопка 56 px снизу (`data-dev="main"`, текст из `setText`, `disabled` по `enable/disable`, «…» при `showProgress`). `HapticFeedback.*` и `openLink` — `console.info("[dev] …")`.
- `main.ts`: `import { devRequested } from "./dev/flag";` и `declare const __KPI_DEV__: boolean;`; в начале `boot()` — `if (__KPI_DEV__ && devRequested(location.search)) (await import("./dev/fake-telegram")).installFakeTelegram(location.search);` (внутри `async function boot()`, не на верхнем уровне модуля). Статического импорта `./dev/fake-telegram` нигде нет.

`dev-url.ts`: без `KPI_BOT_TOKEN` — `dev-url: нужен KPI_BOT_TOKEN dev-backend`, код 1. Токен не начинается с `123456:kpi-` — `dev-url: только тестовый токен 123456:kpi-…, боевым не подписываю`, код 1, без подписи: иначе на сервере, где по `kpi-deploy.md` `backend/.env` загружен в оболочку, скрипт выдал бы рабочий вход за любой `telegram_id`. Подпись `signInitData(token, { telegram_id, auth_date: now })` (импорт `../../backend/src/modules/kpi/tg-app/init-data`). Вывод: `http://localhost:<port>/kpi-app/?init=<encodeURIComponent>&theme=<theme>#<route или />`. `--all` — по строке на каждую персону таблицы ниже: `<tg>  <персона>  <url>`.

`smoke-seed.ts`:
- `DATABASE_URL` не кончается на `/managers_kpi_smoke` → `smoke-seed: только managers_kpi_smoke`, код 1, до любого запроса.
- Повторный запуск сначала удаляет прошлые данные стенда: сотрудников с `last_name LIKE 'Смоук %'` и все их `kpi_*`-строки, привязки с `telegram_id` от 9100000001 до 9100000099, пользователей `login LIKE 'test_kpi_smoke%'` с их назначениями, филиал «Тест Филиал Смоук».
- `PROJECT_PREFIX` должен быть `managers_smoke_`: `seed*` плана 6 под другим префиксом бросают ошибку.
- Роли `staff_roles` стенда — вставить, если их нет (по `code`): `cook` — «Повар» / «Oshpaz», `manager` — «Менеджер филиала» / «Filial menejeri», `hall_worker` — «Работник зала» / «Zal xodimi» (`group_key`, `sort`, `active` — как у `ensureStaffRole` в `http/fixtures.ts`). Без них у всех персон нет карты, а в шапке вместо должности код.
- `seedCards(db)`; `R = currentReviewPeriod(new Date(), settings.review_deadline_day)`, `Q = quarterStart(R)`, `P = addMonths(Q, -3)`. Оценщик стенда — пользователь `test_kpi_smoke_eval` («Тест Смоук Оценщик») с назначением на филиал стенда.
- Фото — PNG 640×480 из `pngSolid(w, h, rgb)` прямо в скрипте (заголовок PNG, `IHDR`, `IDAT` через `zlib.deflateSync`, CRC32 по таблице). `KPI_UPLOADS_DIR` — тот же, что у dev-backend.
- Персоны (имя «Тест», фамилия в таблице, роль `cook`, если не сказано иное; привязка `lang: "ru"`):

| tg | Фамилия | Данные |
|---|---|---|
| 9100000001 | Смоук Оценка | `R`: `[100,100,75,100,90,75,100]`, заметка у пункта 3 «Форма была грязной 14 и 18 числа»; в `R` нарушение с фото по пункту 3 и отменённое «записано по ошибке» |
| 9100000002 | Смоук Два месяца | `R` как у 01 и соседний месяц квартала (следующий в `Q`, иначе предыдущий): `[100,100,100,100,90,100,100]` |
| 9100000003 | Смоук Ждёт | `R` без оценки; `R − 1`: все 100; в `R` два действующих нарушения |
| 9100000004 | Смоук Спор | `R`: `[100,100,75,100,100,100,100]` и открытый спор `via: "miniapp"` |
| 9100000005 | Смоук Изменена | `R` с `change: { old_score_pct: 85, comment: "Пересчитали гигиену" }` и отклонённым спором «Проверили журнал смен» |
| 9100000006 | Смоук Максимум | `R`: все 100 |
| 9100000007 | Смоук Ждём HR | три месяца `P`: 96, 95, 98 (через баллы пунктов); в `Q` ничего; решения нет |
| 9100000008 | Смоук Решение | три месяца `P` как у 07 и решение `approved` 500 000; квартал `P − 3`: один месяц около 83 и решение `rejected` |
| 9100000009 | Смоук Без карты | роль `hall_worker`; оценка (снимок карты `cook`) в `P` |
| 9100000010 | Смоук Уволен | `active = false`, привязка есть |
| 9100000011 | — | привязка пользователя `test_kpi_smoke_eval` |
| 9100000012 | Смоук Руководитель | роль `manager`, `R` без оценки; на тот же tg привязка пользователя `test_kpi_smoke_lead` с назначением на филиал стенда |
| 9100000013 | — | без привязки |

  Итог в консоль: `smoke-seed: R=<R>, персон 13`.

- **Стенд** (команды повторяют задачи 4–7 и 9):
  ```bash
  cd /Users/macbookpro/development/managers-kpi/backend
  export SMOKE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '"' | sed -E 's#/managers(\?.*)?$#/managers_kpi_smoke#')
  case "$SMOKE_URL" in *managers_kpi_smoke) ;; *) echo "не smoke"; exit 1;; esac
  /opt/homebrew/opt/postgresql@17/bin/psql "$SMOKE_URL" -Atc "select 1" || echo "нет managers_kpi_smoke — остановиться и доложить"
  DATABASE_URL="$SMOKE_URL" bunx drizzle-kit migrate
  DATABASE_URL="$SMOKE_URL" PROJECT_PREFIX=managers_smoke_ KPI_UPLOADS_DIR=/tmp/kpi_smoke_uploads bun run src/modules/kpi/tg-app/smoke-seed.ts
  # фоном (Bash run_in_background):
  DATABASE_URL="$SMOKE_URL" NODE_ENV=development PROJECT_PREFIX=managers_smoke_ PORT=6799 ENV=development KPI_BOT_TOKEN=123456:kpi-smoke-dev-token \
    KPI_NOTIFY_QUEUE=kpi_notify_smoke KPI_UPLOADS_DIR=/tmp/kpi_smoke_uploads KPI_ADMIN_URL=http://localhost:6762 bun run src/index.ts
  # фоном:
  cd ../kpi_miniapp && KPI_DEV_API=http://localhost:6799 bun --bun run dev
  # ссылки:
  KPI_BOT_TOKEN=123456:kpi-smoke-dev-token bun scripts/dev-url.ts --all
  ```
  В конце задачи оба фоновых процесса остановить.

- [ ] **Step 1: Написать `test/dev.test.ts`** (импорт только из `../src/dev/flag`): `devRequested("?init=a")`, `"?sdk=fail"`, `"?noinit=1"` → `true`, `""` и `"?theme=dark"` → `false`; у `THEMES.light` и `THEMES.dark` одинаковые 13 ключей; `DEV_MARKER === "__KPI_DEV_FAKE_TELEGRAM__"`.
- [ ] **Step 2: Run** `bun test` — FAIL.
- [ ] **Step 3: Реализовать** `flag.ts`, `fake-telegram.ts`, правку `main.ts`, `dev-url.ts`, `smoke-seed.ts`.
- [ ] **Step 4: Проверки.** `bun test`, `bun --bun run build` — PASS; в `dist/assets/` один `.js`; `grep -rl __KPI_DEV_FAKE_TELEGRAM__ dist` — пусто; `grep -rn 'dev/fake-telegram' kpi_miniapp/src | grep -v 'import("./dev/fake-telegram")'` — пусто. `NODE_ENV=development bun --bun run build` — снова один `.js` и маркера в `dist` нет (константа зависит от команды, не от `NODE_ENV`). `KPI_BOT_TOKEN=7700000000:not-a-test-token bun scripts/dev-url.ts --tg 9100000001` — код 1 и ни одной ссылки. Типы backend (`grep modules/kpi`) — пусто. Поднять стенд; `curl -s -X POST localhost:5174/api/kpi/tg/auth -H 'content-type: application/json' -d "{\"init_data\":\"<init из ссылки 9100000001, раскодированный>\"}"` → 200 с `"roles":["employee"]`; с этим токеном `GET /api/kpi/tg/home` → `employee.month.period` равен `R` из вывода seed. Для 9100000010 — 403 `inactive`, для 9100000013 — 403 `not_bound`. Остановить процессы.
- [ ] **Step 5: Commit**

```bash
git -C /Users/macbookpro/development/managers-kpi add kpi_miniapp/src/dev/flag.ts kpi_miniapp/src/dev/fake-telegram.ts kpi_miniapp/scripts/dev-url.ts kpi_miniapp/test/dev.test.ts kpi_miniapp/src/main.ts backend/src/modules/kpi/tg-app/smoke-seed.ts
git -C /Users/macbookpro/development/managers-kpi commit -m "feat(kpi-app): поддельный Telegram для Chrome и персоны стенда managers_kpi_smoke"
```

---

### Task 4: Оболочка, тема и состояния

**Files:**
- Create: `kpi_miniapp/src/ui.ts`, `src/style.css`, `src/load.ts`, `kpi_miniapp/test/load.test.ts`
- Modify: `kpi_miniapp/index.html` (окончательный), `kpi_miniapp/src/main.ts` (окончательный роутер)

**Interfaces:**
- Consumes: всё из задач 1–3.
- Produces:
  ```ts
  // src/load.ts
  export type Loaded<T> =
    | { kind: "fresh"; data: T } | { kind: "stale"; data: T; at: number }
    | { kind: "fail"; status: FailStatus } | { kind: "http"; code: number; error: string | null };
  export function resolveLoad<T>(r: ApiResult<T>, cached: { data: T; at: number } | null): Loaded<T>;
  export async function loadScreen<T>(path: string, onSlow: () => void): Promise<Loaded<T>>; // appApi().get + appCache() + таймер 8 с; fail not_bound/inactive → appCache().clear()
  // src/ui.ts
  export function h(tag: string, attrs?: Record<string, string | boolean | EventListener>, ...kids: (Node | string | null)[]): HTMLElement; // строки-дети → createTextNode
  export function mount(view: Node): void;                     // в #app, снимает скелетон старта
  export function statusScreen(s: FailStatus, retry?: () => void): HTMLElement; // двуязычный, кнопка «Повторить»/«Qayta urinish» при offline/unknown
  export function skeleton(kind: "home" | "list"): HTMLElement;
  export function staleBanner(at: number): HTMLElement;       // t("offline_stamp", { time: hhmm(at) })
  export function setBack(onBack: (() => void) | null): void;  // Telegram BackButton
  // src/main.ts
  export function navigate(r: Route): void;                    // push в стек и location.hash
  export function back(): void;
  export function rerender(): void;                            // текущий экран заново (после смены языка, спора)
  ```

Правила:
- `resolveLoad`: `ok` → `fresh` (вызывающий сохраняет в кэш); `fail offline` с кэшем → `stale`; `fail` без кэша → `fail`; `http` → `http`.
- `loadScreen`: результат `fail not_bound` или `fail inactive` (повторный вход посреди работы получил 403) — `appCache().clear()` до возврата, экран отказа без устаревших данных (решение 12).
- `h()`: строковые дети — только `document.createTextNode`, значения атрибутов — только `setAttribute`; `innerHTML` в `ui.ts` допустим лишь для статической разметки без подстановок (Global Constraints).
- Роутер: `roles` из ответа входа без `employee` — любой маршрут, кроме главного, заменяется на главный, и `location.hash` переписывается на `#/` (решение 18).
- `index.html`: SDK `<script defer src="https://telegram.org/js/telegram-web-app.js">`; статический скелетон в `#boot`; подсказка `#slow-hint` с двумя строками (`slow` RU и UZ), проявляется CSS-анимацией с задержкой 8 с; `<div id="app"></div>`; `<script type="module" src="/src/main.ts">`. Без inline-скриптов.
- Старт `main.ts`: dev-флаг (задача 3) → `sdkState()` не `ok` → `statusScreen` → `applyTheme()`, `ready()`, `expand()`, `onEvent("themeChanged", applyTheme)` → `appApi().auth()`. Отказ `offline` при кэше главного экрана — главный экран из кэша с `staleBanner`; `not_bound`/`inactive` — `appCache().clear()` и экран отказа; прочее — экран отказа. Успех — `setLang(body.lang)`, роутер по `parseHash(location.hash)`, `hashchange`.
- Экран: `skeleton(...)` сразу, `loadScreen` с `onSlow` → строка `t("slow")` под скелетоном; `stale` → данные и `staleBanner` сверху.
- Цвета берутся из `--tg-theme-*` с запасными значениями. `color-mix()` не использовать: старый WebView его не знает. Производные оттенки задаются отдельными переменными для `[data-scheme="light"]` и `[data-scheme="dark"]`.

- [ ] **Step 0: Вызвать Skill `design-taste-frontend`, затем Skill `frontend-design`.** Открыть макеты `home-layout-v3.html` и `screens.html` в Chrome через стенд или как файлы и держать их перед глазами.
- [ ] **Step 1: Написать `test/load.test.ts`**: `resolveLoad({ kind: "ok", data: 1 }, null)` → `fresh`; `({ kind: "fail", status: "offline" }, { data: 2, at: 5 })` → `{ kind: "stale", data: 2, at: 5 }`; `offline` без кэша → `fail offline`; `expired` с кэшем → `fail expired`; `http 404` → `{ kind: "http", code: 404, error: "not_found" }`.
- [ ] **Step 2: Run** `bun test` — FAIL.
- [ ] **Step 3: Реализовать** `load.ts`, `ui.ts`, `style.css`, окончательные `index.html` и `main.ts` (экраны пока заглушки с заголовком маршрута).
- [ ] **Step 4: Проверка в Chrome** (стенд задачи 3, вкладка 360×780): `?noinit=1` — «Откройте приложение из бота / Ilovani botdan oching»; `?sdk=fail` — «Не загрузился Telegram…»; персона 9100000010 — «Доступ закрыт»; 9100000013 — «Попросите у HR…»; `?theme=dark` меняет фон и текст. Подсказка: заблокировать `telegram.org` в DevTools (Network request blocking) и обновить — через 8 с видна двуязычная строка.
- [ ] **Step 5: Run** `bun test`, `bun --bun run build` — PASS, проверки `dist` из Global Constraints.
- [ ] **Step 6: Commit**

```bash
git -C /Users/macbookpro/development/managers-kpi add kpi_miniapp/index.html kpi_miniapp/src/main.ts kpi_miniapp/src/ui.ts kpi_miniapp/src/style.css kpi_miniapp/src/load.ts kpi_miniapp/test/load.test.ts
git -C /Users/macbookpro/development/managers-kpi commit -m "feat(kpi-app): оболочка, тема Telegram, экраны отказа и работа без сети"
```

---

### Task 5: Главный экран

**Files:**
- Create: `kpi_miniapp/src/view/home.ts`, `src/screens/home.ts`, `kpi_miniapp/test/view-home.test.ts`
- Modify: `kpi_miniapp/src/main.ts` (подключение экрана)

**Interfaces:**
- Consumes: `TgHome` и вложенные типы (план 6); `t`, `monthName`, `monthsList`, `quarterTitle`, `ruPlural`, `pct1`, `sum`, `sumShort`, `dayMonth`, `ddmm`, `initials`, `trackPos`, `hintLines`, `raiseBadge`; `navigate`, `rerender`, `appApi().send`.
- Produces:
  ```ts
  // src/view/home.ts
  export interface HomeVM {
    header: { initials: string; name: string; sub: string } | null;           // sub: "должность · филиал", пустые части выпадают
    evaluator: { text: string; link: string | null } | null;
    pending: { title: string; when: string; violations: string; hash: string } | null;
    month: { title: string; chip: { text: string; tone: "ok" | "wait" | "warn" }; score: string; disputeLine: string;
      lost: { title: string; score: string }[]; lostNone: boolean; hash: string } | null;
    raise: { title: string; badge: { text: string; tone: "prelim" | "ok" | "muted" }; ticks: { pct: string; amount: string; at: number }[];
      marker: { label: string; at: number } | null; months: { label: string; value: string; current: boolean }[]; lines: string[] } | null;
    links: { text: string; count: string | null; hash: string }[];
    noCard: boolean;
  }
  export function homeView(h: TgHome, l: Lang, nowMs: number): HomeVM;
  // src/screens/home.ts
  export function renderHome(vm: HomeVM, h: TgHome): HTMLElement;  // шапка с RU/UZ, карточки, строки-ссылки
  ```

Правила `homeView` (порядок блоков — макет `home-layout-v3.html`):
- Шапка: `employee` есть — его имя; только оценщик — `null` (переключатель языка тогда в карточке оценщика).
- `evaluator.text`: `pending > 0` → `eval_pending` (`{employees}` через `ruPlural`; в UZ без склонения), иначе `eval_done`; `link = admin_url`.
- `pending`: `title = pending_title` с месяцем в именительном (`capFirst`); `when = nowMs < submit_opens_at ? pending_from : pending_until` (даты `dayMonth`); `violations = pending_viol` (предложный); `hash = #/violations/<YYYY-MM>`.
- `month`: `title` — месяц с заглавной; `chip` — `st_*`, тон `ok` для `ready`, `warn` для `dispute_open`, `wait` для прочих; `score = pct1(score_pct)` или `—`; `disputeLine` по `dispute.state`: `can` → `dsp_can` (`deadline`), `open` → `dsp_open` (`opened_at`), `window_closed`, `period_closed` → соответствующие ключи; `lost` — до трёх строк (заголовок на языке, балл целым); `lostNone = lost.length === 0`; `hash = #/review/<YYYY-MM>`.
- `raise`: `title = raise_title` с `quarterTitle`; `badge = raiseBadge(hint)`; `ticks` по `tiers` (`pct1(min_pct)` без десятичной, если целое: `85 %`; `sumShort`; `at = k / (n + 1)`, где `k` — номер ступени с единицы по возрастанию `min_pct`: 85 / 90 / 95 → 0,25 / 0,5 / 0,75, ровно границы отрезков `trackPos`); `marker` при `avg_pct` — `label = pct1(avg_pct, tiers.map(t => t.min_pct)) + " %"`, `at = trackPos(...)`; `months` — три плитки: `scored` → `pct1`, первая `upcoming` → `m_upcoming`, следующие `upcoming` → `—`, `pending` → `m_pending`, `not_rated` → `m_not_rated`; `current` — отчётный месяц (решение 9); `lines = hintLines(hint)`.
- `links`: `link_viol` (предложный, `count` числом) → `#/violations/…`; `link_history` → `#/history`, только при `has_history` или оценённом месяце.
- `noCard = employee !== null && !employee.has_card`: вместо карточек `no_card` и ссылка «История», если `has_history`.
- Нажатие RU/UZ: `PUT /lang`, затем `setLang` и `rerender()`.

- [ ] **Step 0: Вызвать Skill `design-taste-frontend`, затем Skill `frontend-design`.**
- [ ] **Step 1: Написать `test/view-home.test.ts`.** Фикстура `ex1(): TgHome` повторяет макет 1 (сотрудник «Тест Повар», «Повар», «Тест Филиал 1»; октябрь 2026 `score_pct 90.33`, `ready`, `can` до `2026-11-10T18:59:59.999Z`, `lost` «Гигиена сотрудника» 75 и «Соблюдение техкарты» 75; прибавка `quarter_start 2026-10-01`, `tiers` 85/90/95, `avg_pct 90.33`, месяцы `scored 90.33` / `upcoming 2026-11-19T19:00:00.000Z` / `upcoming 2026-12-19T19:00:00.000Z`, `hint` = `EX1` из задачи 2; `violations { period: "2026-10-01", count: 1 }`, `has_history: true`). Ожидания при `nowMs = Date.UTC(2026, 9, 26, 5)`:

```ts
const vm = homeView(ex1(), "ru", NOW);
expect(vm.header).toEqual({ initials: "ТП", name: "Тест Повар", sub: "Повар · Тест Филиал 1" });
expect(vm.month).toMatchObject({ title: "Октябрь", chip: { text: "Оценка готова", tone: "ok" }, score: "90,3",
  disputeLine: "Оспорить можно до 10 ноября.", lost: [{ title: "Гигиена сотрудника", score: "75" }, { title: "Соблюдение техкарты", score: "75" }], lostNone: false, hash: "#/review/2026-10" });
expect(vm.raise!.title).toBe("Прибавка за IV квартал");
expect(vm.raise!.ticks.map((x) => [x.pct, x.amount, x.at])).toEqual([[`85${nb}%`, `150${nb}тыс`, 0.25], [`90${nb}%`, `300${nb}тыс`, 0.5], [`95${nb}%`, `500${nb}тыс`, 0.75]]);
expect(vm.raise!.marker!.label).toBe(`90,3${nb}%`);
expect(vm.raise!.marker!.at).toBeCloseTo(0.5165, 6);
expect(vm.raise!.months).toEqual([{ label: "Октябрь", value: "90,3", current: true }, { label: "Ноябрь", value: "с 20.11", current: false }, { label: "Декабрь", value: "—", current: false }]);
expect(vm.links).toEqual([{ text: "Нарушения в октябре", count: "1", hash: "#/violations/2026-10" }, { text: "История", count: null, hash: "#/history" }]);
```

  Ещё случаи, по одному `expect` на каждый: статус `dispute_open` с `opened_at 2026-11-27T06:00:00.000Z` → чип «Спор на рассмотрении» тона `warn` и строка «Вы оспорили оценку 27 ноября. Ответ придёт в бот.»; `window_closed` → «Срок спора прошёл.»; `lost: []` → `lostNone: true`; `pending` при `nowMs` до 20 ноября → `{ title: "Ноябрь ещё не оценён", when: "Оценку поставят с 20 ноября.", violations: "Нарушений в ноябре: 2" }`, после — `when: "Оценку поставят до 7 декабря."`; оценщик `pending 1` → «Нужно оценить 1 сотрудника до 7 ноября», `pending 5` → «…5 сотрудников…», `0` → «Все ваши сотрудники оценены»; `has_card: false` → `noCard: true`, `month`, `raise` `null`; то же `ex1()` на `uz` → чип «Baho tayyor», строка ссылки «Oktabrdagi qoidabuzarliklar», `marker.label` `90,3 %`.

  `marker.at` = `trackPos(90.33, [85, 90, 95])` = `(2 + 0.066) / 4` = `0.5165`.

- [ ] **Step 2: Run** `bun test` — FAIL.
- [ ] **Step 3: Реализовать** `view/home.ts`, `screens/home.ts`, подключить в `main.ts`.
- [ ] **Step 4: Проверка в Chrome** на стенде, 360×780, светлая и тёмная: персоны 01, 02, 03, 04, 06, 07, 08, 09, 11, 12. Порядок блоков как в макете, нет горизонтальной прокрутки, переключатель RU/UZ меняет все тексты.
- [ ] **Step 5: Run** `bun test`, `bun --bun run build` — PASS.
- [ ] **Step 6: Commit**

```bash
git -C /Users/macbookpro/development/managers-kpi add kpi_miniapp/src/view/home.ts kpi_miniapp/src/screens/home.ts kpi_miniapp/src/main.ts kpi_miniapp/test/view-home.test.ts
git -C /Users/macbookpro/development/managers-kpi commit -m "feat(kpi-app): главный экран — месяц, прибавка, оценщик"
```

---

### Task 6: Вся оценка и спор

**Files:**
- Create: `kpi_miniapp/src/view/review.ts`, `src/screens/review.ts`, `src/sheet.ts`, `kpi_miniapp/test/view-review.test.ts`
- Modify: `kpi_miniapp/src/main.ts`

**Interfaces:**
- Consumes: `TgReview`, `TgDisputeCreated`, `TgError` (план 6); `latch`, `reasonCount`, `haptic`, `webApp().MainButton`, `appApi().send`, `rerender`, `setBack`.
- Produces:
  ```ts
  // src/view/review.ts
  export interface ReviewVM {
    title: string;                                            // "Октябрь · 90,3 %"
    groups: { title: string; items: { title: string; score: string; bar: number | null; source: string | null; note: string | null; noData: boolean }[] }[];
    changes: { line: string; reason: string | null }[];       // "12 октября: 85,0 % → 90,3 %"
    resolved: { title: string; comment: string | null } | null;
    dispute: { can: true; label: string } | { can: false; line: string };
  }
  export function reviewView(r: TgReview, l: Lang): ReviewVM;
  export function disputeErrorText(code: string | null, min: number): string; // err_* или err_generic; здесь, а не в sheet.ts: тест не импортирует DOM-модули
  // src/sheet.ts
  export function openDisputeSheet(o: { subject_type: "review" | "violation"; subject_id: string; title: string; reasonMin: number; onDone(): void }): void; // текст ошибки — disputeErrorText из view/review.ts
  ```

Правила:
- Группы: «Основные пункты», затем «Дополнительные пункты», если такие есть. `bar = score / 100`, у `null` — `null` и `noData: true` (балл `—`, пояснение `no_data_hint`). `source`: `attendance` → `src_attendance`; `cooking_speed`, `sales_plan`, `food_cost` → `src_branch`; `manual` → `null`.
- `changes`: `dayMonth(at)`, `pct1(old)` → `pct1(new)`, `reason = change_reason`. `old_score_pct` или `new_score_pct` равен `null` — на его месте `—` без знака `%` (`pct1` с `null` не вызывается).
- `resolved` из `dispute.last_resolved`: `dsp_accepted`/`dsp_rejected` и `comment`.
- `dispute`: `can` → кнопка `btn_dispute`; иначе строка `dsp_open` / `dsp_window_closed` / `dsp_period_closed`.
- Шторка: снизу, заголовок, `sheet_hint`, `textarea` с `sheet_placeholder`, счётчик `sheet_min`. `MainButton.setText(t("sheet_send"))`, `show()`; `enable()` только при `reasonCount(text) >= reasonMin`. Нажатие: `latch.take()`, `showProgress()`, `POST /disputes`; 200 → `haptic("success")`, `MainButton.hide()`, закрыть, `onDone()` (перезагрузка экрана); ошибка → `haptic("error")`, `disputeErrorText(error, min)` под полем, `hideProgress()`, `latch.release()`. `BackButton` при открытой шторке закрывает её. При закрытии снимаются все обработчики `MainButton`.

- [ ] **Step 0: Вызвать Skill `design-taste-frontend`, затем Skill `frontend-design`.**
- [ ] **Step 1: Написать `test/view-review.test.ts`**: фикстура с девятью пунктами (`attendance` без балла, `Гигиена сотрудника` 75 с заметкой, два `extra`), изменением `{ at: "2026-10-27T07:00:00.000Z", old_score_pct: 85, new_score_pct: 90.33, comment: "Пересчитали гигиену" }`, `dispute.state = "can"`. Ожидания: `title` `Октябрь · 90,3 %` (с U+00A0 перед `%`); две группы с заголовками «Основные пункты», «Дополнительные пункты»; первый пункт `{ score: "—", bar: null, source: "по данным Workly", noData: true }`; `changes` `[{ line: "27 октября: 85,0 % → 90,3 %", reason: "Причина: Пересчитали гигиену" }]` (U+00A0 перед `%`); `dispute` `{ can: true, label: "Оспорить" }`; при `state: "open"` — `{ can: false, line: "Вы оспорили оценку … Ответ придёт в бот." }`; `last_resolved` `rejected` с комментарием → `resolved: { title: "Спор отклонён", comment: "Комментарий: …" }`; изменение с `old_score_pct: null` → строка `27 октября: — → 90,3 %`. `disputeErrorText` импортируется из `../src/view/review`: `disputeErrorText("comment_required", 5)` → «Слишком коротко: нужно не меньше 5 букв или цифр.», `disputeErrorText("weird", 5)` → «Не получилось. Попробуйте ещё раз.».
- [ ] **Step 2: Run** `bun test` — FAIL.
- [ ] **Step 3: Реализовать** `view/review.ts`, `screens/review.ts`, `sheet.ts`, маршрут в `main.ts`. `404` на экране — `err_not_found` и «назад».
- [ ] **Step 4: Проверка в Chrome** на стенде: персона 01 → «Вся оценка» → «Оспорить» → кнопка `data-dev="main"` неактивна при «ок», активна после «18 числа был выходной»; отправка → шторка закрылась, на главном «Спор на рассмотрении»; повторный вход на экран — строки «Вы оспорили…», кнопки нет. Персона 05 — блок «Изменения» и «Спор отклонён». После проверки перезапустить `smoke-seed.ts`.
- [ ] **Step 5: Run** `bun test`, `bun --bun run build` — PASS.
- [ ] **Step 6: Commit**

```bash
git -C /Users/macbookpro/development/managers-kpi add kpi_miniapp/src/view/review.ts kpi_miniapp/src/screens/review.ts kpi_miniapp/src/sheet.ts kpi_miniapp/src/main.ts kpi_miniapp/test/view-review.test.ts
git -C /Users/macbookpro/development/managers-kpi commit -m "feat(kpi-app): разбор оценки и спор из шторки с MainButton"
```

---

### Task 7: Нарушения, фото и история

**Files:**
- Create: `kpi_miniapp/src/view/violations.ts`, `src/view/history.ts`, `src/screens/violations.ts`, `src/screens/history.ts`, `src/photo.ts`, `kpi_miniapp/test/view-violations.test.ts`, `kpi_miniapp/test/view-history.test.ts`
- Modify: `kpi_miniapp/src/main.ts`

**Interfaces:**
- Consumes: `TgViolations`, `TgHistory` (план 6); `openDisputeSheet` (задача 6); `appApi().blob`; `navigate`.
- Produces:
  ```ts
  export interface ViolationVM { id: string; item: string; when: string; comment: string; status: { text: string; tone: "active" | "muted" | "warn" };
    cancelReason: string | null; photoIds: string[]; canDispute: boolean; line: string | null }
  export function violationsView(v: TgViolations, l: Lang): { title: string; items: ViolationVM[]; note: string; empty: boolean };
  export interface QuarterVM { title: string; result: { text: string; tone: "ok" | "muted" | "wait" }; months: { label: string; value: string; hash: string | null }[]; avg: string | null }
  export function historyView(h: TgHistory, l: Lang): { quarters: QuarterVM[]; empty: boolean };
  // src/photo.ts
  export async function photoThumb(id: string): Promise<HTMLElement>;   // blob-URL или заглушка photo_failed
  export function openPhoto(url: string): void;                          // на весь экран, закрытие тапом и BackButton
  export function revokeAll(): void;                                     // при уходе с экрана
  ```

Правила:
- Нарушения: `item` — название на языке (`item_title_uz ?? item_title_ru` для UZ) или `viol_no_item`; `when` — `dayMonth` и `hhmm` по Ташкенту («14 октября, 19:40»); статус: `cancelled` → `viol_cancelled` (`muted`), открытый спор → `viol_dispute` (`warn`), иначе `viol_active`; `canDispute = dispute.state === "can"`; `line` — у каждого нарушения без «Оспорить» (спека, раздел 4.5): `open` → `dsp_open_violation` с `dayMonth(opened_at)`, `cancelled` → `dsp_cancelled`, `window_closed` / `period_closed` → `dsp_window_closed` / `dsp_period_closed`; при `can` — `null`. `dsp_open` («оспорили оценку») у нарушений не используется. Внизу всегда `viol_note`. Пустой список — `viol_empty`.
- История: `title = quarterTitle(q, l, true)`; `result`: `running` → `hist_running` (`wait`), `waiting_hr` → `hist_waiting` (`wait`), `decided` > 0 → `hist_approved` «Утверждено +N сум» (`ok`), 0 → `hist_no_raise` «Без прибавки» (`muted`) — слова раздела 4.4 спеки; месяцы: `scored` → `pct1 + " %"` и `hash` на «Вся оценка», первая `upcoming` → `hist_upcoming` с `dayMonth(opens_at)`, прочие `upcoming` → `—`, `pending` → `hist_pending` «ещё не оценён», `not_rated` → `m_not_rated`; `avg` при `avg_pct` → `pct1 + " %"`. Пустая история — `hist_empty`.

- [ ] **Step 0: Вызвать Skill `design-taste-frontend`, затем Skill `frontend-design`.**
- [ ] **Step 1: Тесты.** `test/view-violations.test.ts`: три нарушения как в `screens.html` (действующее с фото по «Чистоте филиала» `2026-10-14T14:40:00.000Z`, отменённое без пункта «записано по ошибке», со спором) → `items[0].when` `"14 октября, 19:40"`, `items[0].status` `{ text: "действует", tone: "active" }`, отменённое `{ text: "отменено", tone: "muted" }` и `cancelReason` «записано по ошибке», `item` «Без пункта карты», со спором — `{ text: "спор открыт", tone: "warn" }`, `canDispute: false` и `line` «Вы оспорили нарушение 20 октября. Ответ придёт в бот.» (спор открыт `2026-10-20T07:00:00.000Z`); у отменённого `line` «Нарушение отменено, оспаривать нечего.»; у действующего с `can` — `line: null`; `note` — `viol_note`. `test/view-history.test.ts`: три квартала как в `screens.html` (IV 2026 идёт: октябрь 90,3, ноябрь `upcoming`, декабрь `upcoming`; III 2026 `decided 500000`, июль 96, август 95, сентябрь 98, средний 96,33; II 2026 `decided 0`, средний 83,1) → заголовки «IV квартал 2026», …; итоги «идёт», `Утверждено +500 000 сум`, «Без прибавки» (U+00A0 внутри числа и перед «сум»); месяцы IV: `90,3 %`, «с 20 ноября», «—»; месяц `pending` в истории — «ещё не оценён»; `avg` III `96,3 %`; `hash` у оценённого месяца `#/review/2026-10`.
- [ ] **Step 2: Run** `bun test` — FAIL.
- [ ] **Step 3: Реализовать** модули, маршруты, «Оспорить» у нарушения через `openDisputeSheet({ subject_type: "violation", … })`.
- [ ] **Step 4: Проверка в Chrome**: персона 01 — нарушения, превью фото, крупный просмотр и закрытие; персона 08 — история с итогами, тап по месяцу открывает «Вся оценка». После ухода с экрана нарушений в консоли нет ошибок.
- [ ] **Step 5: Run** `bun test`, `bun --bun run build` — PASS.
- [ ] **Step 6: Commit**

```bash
git -C /Users/macbookpro/development/managers-kpi add kpi_miniapp/src/view/violations.ts kpi_miniapp/src/view/history.ts kpi_miniapp/src/screens/violations.ts kpi_miniapp/src/screens/history.ts kpi_miniapp/src/photo.ts kpi_miniapp/src/main.ts kpi_miniapp/test/view-violations.test.ts kpi_miniapp/test/view-history.test.ts
git -C /Users/macbookpro/development/managers-kpi commit -m "feat(kpi-app): нарушения с фото и история кварталов"
```

---

### Task 8: Подписи в админке и заметки к деплою

**Files:**
- Modify: `admin/app/[locale]/kpi/_components/item-score-row.tsx`, `admin/app/[locale]/kpi/reviews/_components/review-sheet.tsx`, `admin/app/[locale]/kpi/violations/new/page.tsx`, `admin/app/[locale]/kpi/settings/_components/invite-dialog.tsx`, `admin/app/[locale]/kpi/disputes/page.tsx`, `docs/superpowers/kpi-deploy.md`

**Interfaces:**
- Consumes: `DisputeRow.opened_via: "admin" | "telegram" | "miniapp"` (план 6, задача 5); `TgTarget` в `invite-dialog.tsx`.
- Produces: строки интерфейса; раздел `kpi-deploy.md`.

Правки (каждая — `<p className="text-xs text-muted-foreground">…</p>` под полем):
- `item-score-row.tsx`, под полем заметки (около строки 158): «Заметку увидит сотрудник».
- `review-sheet.tsx`, под комментарием к изменению, после «Не меньше {commentMin} символов без пробелов» (около строки 321): «Причину изменения увидит сотрудник».
- `violations/new/page.tsx`, под полем «Что случилось» (около строки 219): «Комментарий увидит сотрудник».
- `invite-dialog.tsx`, только при `"employee_id" in target`, под подсказкой срока: «После привязки сотрудник откроет „Мой KPI“ кнопкой меню бота».
- `disputes/page.tsx`, рядом с «через Telegram» (строка 102): `{d.opened_via === "miniapp" && <span className="text-xs text-muted-foreground">через мини-приложение</span>}`.

Раздел `kpi-deploy.md` «## Мини-приложение «Мой KPI»» после «Фазы 5», подразделы:
1. **Миграция** `0040_kpi_tg_dual` (индексы привязок): номер сверить с прод-`main`, SQL прочитать до `bunx drizzle-kit migrate`. Других миграций нет; `opened_via = 'miniapp'` пишется в существующий `varchar(16)`.
2. **Сборка:** `cd /home/davr/managers/kpi_miniapp && /root/.bun/bin/bun install && /root/.bun/bin/bun --bun run build` (почему `--bun` — комментарий в `vite.config.ts` паспорта). Глазами: в `dist/index.html` пути начинаются с `/kpi-app/assets/`; в `dist/assets/` ровно один `.js` и один `.css`; `grep -rl __KPI_DEV_FAKE_TELEGRAM__ dist` пусто (маркер пишет поддельный Telegram, так что его отсутствие значит, что подделки в сборке нет). Сборке нужен соседний `backend/` (типы). `kpi_miniapp/scripts/dev-url.ts` на сервере не запускать: он подписывает только тестовыми токенами `123456:kpi-…` и на боевой ответит отказом.
3. **nginx**, vhost `api.office.lesailes.uz`, внутри `server { … 443 … }` до `location /`, с бэкапом `<vhost>.bak.kpi_app_<YYYYMMDD-HHMMSS>`, `nginx -t`, `systemctl reload nginx`:
   ```
       # KPI MINIAPP START #
       location ^~ /kpi-app/ {
           alias /home/davr/managers/kpi_miniapp/dist/;
           index index.html;
           try_files $uri $uri/ /kpi-app/index.html;
           add_header Cache-Control "no-cache";
       }
       # KPI MINIAPP END #
   ```
   Тот же origin, что у API, обязателен (раздел 1 спеки паспорта C5): `base` в `vite.config.ts`, `location` и `KPI_MINIAPP_URL` совпадают буква в букву, со слэшем.
4. **Переменные:** `backend/.env` — `KPI_MINIAPP_URL=https://api.office.lesailes.uz/kpi-app/`, `KPI_ADMIN_URL=<адрес админки без пути>`; `cron/.env` — тот же `KPI_MINIAPP_URL` (кнопки «Открыть» собирает воркер). `tail -c 1 .env` перед дописыванием. Только `https://`: иначе кнопок не будет.
5. **Перезапуск:** `office_api` с пересборкой бинарника и `office_kpi_worker`, без `--update-env` (см. «Воркер office_kpi_worker»).
6. **Кнопка меню:** `cd /home/davr/managers/backend && bun run src/modules/kpi/tg/set-menu.ts`; ожидаемый вывод `kpi menu: default ok, uz chats N/N` и код 0; код 1 — кнопка по умолчанию не встала, разобраться до проверки с телефона. Запускать после установки `KPI_MINIAPP_URL`; повторный запуск безопасен.
7. **Проверка с телефона:** кнопка меню «Мой KPI» открывает приложение; светлая и тёмная тема Telegram; переключатель RU/UZ; уведомление об оценке — кнопка «Открыть» ведёт на «Вся оценка» этого месяца; `/my` — кнопка «Открыть Мой KPI»; руководитель по второй ссылке получает «Готово. Теперь здесь и ваши оценки, и напоминания оценщика.»; спор из приложения появляется в «Спорах» с пометкой «через мини-приложение».

- [ ] **Step 0: База типов админки.** Run: `cd admin && ./node_modules/.bin/tsc --noEmit -p . --incremental false 2>&1 | grep -c "error TS"` — записать число (ожидается `0`).
- [ ] **Step 1: Правки админки.**
- [ ] **Step 2: Проверки.** `grep -c` каждой из пяти строк в своём файле — по `1`; типы админки — число как на шаге 0; `ESLINT_USE_FLAT_CONFIG=false ./node_modules/.bin/eslint` по пяти файлам — чисто; `cd admin && bun test ./lib/kpi ./lib/kpi-api.test.ts` — PASS.
- [ ] **Step 3: Раздел `kpi-deploy.md`.**
- [ ] **Step 4: Commit**

```bash
git -C /Users/macbookpro/development/managers-kpi add "admin/app/[locale]/kpi/_components/item-score-row.tsx" "admin/app/[locale]/kpi/reviews/_components/review-sheet.tsx" "admin/app/[locale]/kpi/violations/new/page.tsx" "admin/app/[locale]/kpi/settings/_components/invite-dialog.tsx" "admin/app/[locale]/kpi/disputes/page.tsx" docs/superpowers/kpi-deploy.md
git -C /Users/macbookpro/development/managers-kpi commit -m "feat(kpi): подписи «увидит сотрудник» в админке и заметки к деплою мини-приложения"
```

---

### Task 9: Визуальная проверка в Chrome (смотреть и чинить)

**Files:**
- Modify: любые файлы `kpi_miniapp/src/` по найденному; `docs/superpowers/kpi-handoff.md` (раздел о проверке)

**Interfaces:**
- Consumes: стенд задачи 3; все экраны задач 4–7.
- Produces: исправления и абзац в `kpi-handoff.md`.

Матрица состояний (спека, разделы 4 и 12). Адрес — ссылка `dev-url.ts` для персоны; `R` — отчётный месяц из вывода seed.

| # | Состояние | Персона, маршрут, действие | Что должно быть видно |
|---|---|---|---|
| 1 | Месяц оценён, оценён 1 из 3 | 01, `#/` | «Оценка готова», балл, «Оспорить можно до …», три потерянных пункта, шкала с маркером, три строки подсказки |
| 2 | Квартал идёт, оценено 2 | 02, `#/` | «Сейчас выходит …», строки «Сохранится…» и «Для …» или «… уже не получится» |
| 3 | Отчётный месяц не оценён | 03, `#/` | короткая карточка «… ещё не оценён», под ней карточка прошлого месяца |
| 4 | Спор на рассмотрении | 04, `#/` | чип и «Вы оспорили оценку …» |
| 5 | Изменена, спор разобран | 05, `#/` и `#/review/R` | «Спор разобран»; блок «Изменения», «Спор отклонён» с комментарием |
| 6 | Все пункты на максимуме | 06, `#/` | «Все пункты на максимуме» |
| 7 | Ждём решения HR | 07, `#/` | прошлый квартал, «Ждём решения HR. Предварительно: …» |
| 8 | Решение есть | 08, `#/` | «Утверждено: +500 000 сум», подсказки нет |
| 9 | Без карты | 09, `#/` | «Для вашей должности KPI пока не настроен», «История» |
| 10 | Уволен | 10 | «Доступ закрыт» |
| 11 | Не привязан | 13 | «Попросите у HR ссылку-приглашение в бот» |
| 12 | Оценщик | 11 | «Нужно оценить N сотрудников до …», «Открыть в админке» |
| 13 | Оценщик и сотрудник | 12 | карточка оценщика сверху, ниже экран сотрудника |
| 14 | Вся оценка | 01, `#/review/R` | группы, «по данным Workly», заметка, «нет данных», «Оспорить» |
| 15 | Шторка спора | 01, «Оспорить» | поле, «Не меньше 5 букв или цифр», MainButton неактивна до минимума |
| 16 | Спор отправлен | 15 → отправить | шторка закрыта, «Спор на рассмотрении»; затем перезапустить seed |
| 17 | Нарушения | 01, `#/violations/R` | новые сверху, превью фото, отменённое серым с причиной и строкой «Нарушение отменено, оспаривать нечего.», пояснение внизу |
| 18 | Фото крупно | 17 → тап по превью | фото на весь экран, закрытие тапом и «назад» |
| 19 | История | 08, `#/history` | кварталы, «Утверждено +500 000 сум», «Без прибавки», средние |
| 20 | Нет сети, кэш есть | 01: загрузить, затем `emulate` Offline и перейти на «История» и обратно | прежний главный экран и «Обновлено в … — нет связи» |
| 21 | Нет сети, кэша нет | 06 в новой вкладке, `localStorage.clear()`, Offline | «Нет связи…» и «Повторить» |
| 22 | Плохая связь | 01, блокировка `telegram.org` или задержка сети больше 8 с | скелетон и через 8 с «Связь плохая, ещё пробуем» |
| 23 | Вне Telegram | `?noinit=1` | «Откройте приложение из бота» |
| 24 | SDK не загрузился | `?sdk=fail` | «Не загрузился Telegram. Обновите или откройте позже» |

Сочетания: каждое состояние — светлая RU, тёмная RU, светлая UZ (двуязычные 10, 11, 21–24 — только две темы). Тёмная UZ дополнительно для 1, 2, 13, 14, 15, 17, 19. Язык переключается кнопкой RU/UZ в приложении, тема — `&theme=`.

Оценщик (11) после загрузки открывает `#/history` вручную — остаётся на главном экране, без ошибки 403 (решение 18).

Проверка каждого снимка (`evaluate_script`):
- `document.documentElement.scrollWidth <= 360`;
- у `button, a, [role=button], textarea, input` и строк-ссылок высота и ширина не меньше 44 px;
- основной текст не меньше 14 px, подписи шкалы и пометки не меньше 12 px;
- у элементов с числами `font-variant-numeric` содержит `tabular-nums`;
- текст не обрезан и не вылезает (`scrollWidth > clientWidth` у текстовых блоков — сигнал);
- в консоли нет ошибок (`list_console_messages`);
- контраст: `lighthouse_audit` (accessibility) на 1, 14, 17, 19 в обеих темах без провала `color-contrast`.

- [ ] **Step 0: Инструменты и скиллы.** Загрузить инструменты: ToolSearch `select:mcp__chrome-attach__list_pages,mcp__chrome-attach__new_page,mcp__chrome-attach__navigate_page,mcp__chrome-attach__resize_page,mcp__chrome-attach__emulate,mcp__chrome-attach__take_screenshot,mcp__chrome-attach__take_snapshot,mcp__chrome-attach__click,mcp__chrome-attach__fill,mcp__chrome-attach__evaluate_script,mcp__chrome-attach__list_console_messages,mcp__chrome-attach__lighthouse_audit,mcp__chrome-attach__wait_for`. Если `list_pages` не видит браузер — поднять его скиллом `chrome-debug-session`. Вызвать Skill `design-taste-frontend` и Skill `frontend-design`: правки этой задачи — UI.
- [ ] **Step 1: Поднять стенд** (задача 3, полностью, со `smoke-seed.ts`); `KPI_BOT_TOKEN=123456:kpi-smoke-dev-token bun scripts/dev-url.ts --all`.
- [ ] **Step 2: Окно 360×780** (`resize_page` или `emulate` viewport).
- [ ] **Step 3: Обход матрицы.** На каждое сочетание — снимок `NN-<состояние>-<light|dark>-<ru|uz>.png` в scratchpad и проверки списка выше.
- [ ] **Step 4: Смотреть и чинить.** Всё, что выбивается из макета (порядок и состав блоков), из ограничений раздела 9 или выглядит неряшливо по меркам двух скиллов, — исправить, пересобрать (dev-сервер подхватит сам), снять заново это состояние во всех затронутых сочетаниях. Повторять, пока весь список не чист. Логику не менять без теста: если правка трогает `src/view/*`, `src/format.ts`, `src/hint.ts` — сначала тест в `kpi_miniapp/test/`.
- [ ] **Step 5: Итоговые проверки.** `bun test`, `bun --bun run build`, проверки `dist` из Global Constraints. Остановить фоновые процессы.
- [ ] **Step 6: `kpi-handoff.md`.** Абзац «Мини-приложение: проверка в Chrome»: дата, стенд (`managers_kpi_smoke`, поддельный Telegram), сколько состояний и сочетаний снято, что найдено и исправлено одной строкой на пункт, что осталось проверить на настоящем телефоне (Telegram на Android и iOS, старый WebView).
- [ ] **Step 7: Commit** (только изменённые файлы, поимённо)

```bash
git -C /Users/macbookpro/development/managers-kpi add <изменённые файлы kpi_miniapp/...> docs/superpowers/kpi-handoff.md
git -C /Users/macbookpro/development/managers-kpi commit -m "fix(kpi-app): правки по визуальной проверке в Chrome"
```

---

## Покрытие спеки

| Раздел спеки мини-приложения | Задача |
|---|---|
| 3 роли на экране: сотрудник, без карты, уволен, оценщик, обе привязки, не привязан | 4 (отказы), 5 (главный), 9 (10–13) |
| 4.1 главный экран: шапка, месяц, короткая карточка, прибавка, строки-ссылки | 5 |
| 4.2 вся оценка, 4.5 спор (шторка, MainButton, условия кнопки) | 6 |
| 4.3 нарушения и фото, 4.4 история | 7 |
| 4.6 загрузка, 8 с, нет сети, вне Telegram, SDK не загрузился | 1 (API), 4 (оболочка), 9 (20–24) |
| 5 подсказка (рисование готовых чисел) | 2 (`hintLines`), 5 |
| 6 что видно сотруднику | данные плана 6; экраны показывают только их |
| 9 фронт: стек, раздача, Telegram, языки, дизайн через два скилла, плохая связь, режим разработки | 1–7 (скиллы в 4–7 и 9), 3 (dev) |
| 10 админка: три подписи и подсказка в приглашении; 11 источник спора в админке | 8 |
| 11 деплой: сборка, nginx, `KPI_MINIAPP_URL`, `set-menu.ts`, проверка | 8 |
| 12 фронт: сборка и типы, обход в Chrome 360×780 в обеих темах и на обоих языках | 1–7 (сборка), 9 |
