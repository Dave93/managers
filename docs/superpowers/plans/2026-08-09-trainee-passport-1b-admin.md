# Trainee Passport — Plan 1b: Office Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Дать HR и департаментам рабочий интерфейс паспорта стажёра в office-админке: конструктор куррикулума (двуязычный, с возможностью снять с публикации), стажировки с печатью QR-инвайта, матрица прогресса, привязка наставников — плюс недостающие backend-роуты под это.

**Architecture:** Backend — дополнение существующего модуля `passport` в office_api. Frontend — новый раздел `admin/app/[locale]/passport/` в Next.js-админке (shadcn/ui + TanStack Query/Table/Form), API через hand-typed клиент (Eden не типизирует passport — контроллеры экспортированы через `as unknown as Elysia`).

**Tech Stack:** Bun, Elysia, Drizzle, Postgres; Next.js 15 + React 19, shadcn/ui (new-york, Radix), TanStack Query/Table/react-form, @dnd-kit (установлен, 0 использований), next-intl.

## Global Constraints

- Спека: `/home/davr/managers/docs/superpowers/specs/2026-08-08-trainee-passport-design.md`. Плана 1a: `docs/superpowers/plans/2026-08-08-trainee-passport-1a-backend-core.md`.
- Работа НА СЕРВЕРЕ `choparpizza.uz` в `/home/davr/managers`, ветка `main` (1a смержен). Коммит после каждой задачи. Никогда `git add -A` — в дереве чужая незакоммиченная работа (credit/*, cron/*, *.bak).
- `bun` НЕ в PATH при неинтерактивном ssh → `/root/.bun/bin/bun`, `/root/.bun/bin/bunx`.
- ПРОД-БОКС. Запрещено: `pkill`/`killall`/любой pattern-kill (прод-воркеры матчатся на `app.new`; предыдущий агент так уронил два сервиса). Smoke-инстанс — throwaway порт + throwaway `CREDIT_SOCKET_PATH`, убивать по захваченному PID, проверять что ничего не осталось слушать (бинарь re-exec'ится в detached child). Не рестартить pm2 вне задачи деплоя. Не печатать `.env`.
- БД продовая. Миграции только аддитивные, SQL читать перед применением. Тестовые строки убирать за собой; таблицы `passport_*` сейчас пустые.
- Backend-контроллер passport зарегистрирован в `backend/src/app.ts` (НЕ в `controllers.ts`) через `as unknown as Elysia` — новые роуты добавлять в существующие `controller.ts` / `tg-controller.ts`.
- Frontend-конвенции (из разведки, `scratchpad/sdd/passport-1a/recon-admin.md`): shadcn/ui в `admin/components/ui/`; создание/редактирование — **Sheet**, не Dialog; server-state — **TanStack Query**; таблицы — TanStack Table через per-section `data-table.tsx` (общего нет — копировать `app/[locale]/attestation/tests/data-table.tsx`); формы — **@tanstack/react-form** (НЕ react-hook-form, он заброшен); API — копировать структуру `admin/lib/credit-api.ts`; навигация — `components/layout/nav-config.tsx` + `useFilteredNav()`; per-section layout — копировать `app/[locale]/attestation/layout.tsx`.
- Двуязычие: UI-строки — next-intl (как в остальной админке). Контент паспорта — это ДАННЫЕ: поля `*_ru` и `*_uz` (узбекская латиница) редактируются рядом в одной форме. Не путать.
- UI-процесс (требование заказчика): дизайн-направление уже снято с dribbble-референсов (LMS-дашборды, skills-matrix) — матрица «стажёры × модули» с цветными чипами уровней и компактной полосой метрик сверху; дерево куррикулума слева + редактор справа; статусы цветом, просрочка красным. При верстке применять скиллы `aesthetic` / `design-taste-frontend`.
- Уровни: 1 «увидел» серый, 2 «сделал» янтарный, 3 «сам» зелёный, 4 «учит» акцентный. Просрочка дедлайна — красный.
- Деплой — ТОЛЬКО в задаче B8. Промежуточные задачи не собирают бинарь и не рестартят pm2. Коммит `f0fa714` (фикс-волна 1a) поедет вместе с B8.

---

### Task B1: Backend — снятие модуля с публикации и отвязка от программы

**Почему первая:** финальное ревью 1a назвало это блокером перед выдачей HR права публиковать: сейчас первая же ошибка в опубликованном модуле необратима через API (модуль заморожен, `active` нет, DELETE связи нет, `new-version` плодит дубль).

**Files:**
- Modify: `backend/drizzle/schema.ts` (+ миграция)
- Modify: `backend/src/modules/passport/controller.ts`

**Interfaces:**
- Produces:
  - `passport_modules.active` boolean default true not null.
  - `POST /passport/modules/:id/unpublish` (permission `passport.curriculum.publish`) — published → draft. Отказ 409, если по этому модулю уже есть прогресс (`passport_topic_progress` по темам модуля) — снятие с публикацией живых стажёров ломает их путь; в этом случае путь только через `new-version`.
  - `POST /passport/modules/:id/deactivate` / `activate` (publish) — `active=false` убирает модуль из выдачи стажёру и из конструктора по умолчанию, не трогая историю.
  - `DELETE /passport/program-modules` (publish) body `{program_id, module_id}` — снимает связь; 409, если по этой программе есть активные стажировки с прогрессом по темам модуля.
  - `GET /passport/modules` получает `?include_inactive=true` (по умолчанию скрывает `active=false`).
  - Трейни-выдача (`tg-controller.ts` `/me`) фильтрует `passport_modules.active = true` — ЭТО ЕДИНСТВЕННОЕ, что меняется в tg-controller в этой задаче.

- [ ] **Step 1: Схема + миграция**

В `passport_modules` добавить `active: boolean("active").default(true).notNull(),`. Затем:

Run: `cd /home/davr/managers/backend && /root/.bun/bin/bunx drizzle-kit generate && cat drizzle/migrations/00*_*.sql | tail -20`
Expected: ровно один `ALTER TABLE "passport_modules" ADD COLUMN "active" boolean DEFAULT true NOT NULL;`. Что-либо ещё → STOP, report BLOCKED.
Затем `bunx drizzle-kit migrate`.

- [ ] **Step 2: Эндпоинты**

Паттерн — как соседние в этом файле: `permission` макрос, `t.String({ format: "uuid" })` на uuid-полях, многошаговые записи в `drizzle.transaction` с `tx` на каждом стейтменте. Пример guard-запроса «есть ли прогресс по модулю»:

```ts
const progressCount = await drizzle
  .select({ n: sql<number>`count(*)` })
  .from(passport_topic_progress)
  .innerJoin(passport_topics, eq(passport_topics.id, passport_topic_progress.topic_id))
  .where(eq(passport_topics.module_id, params.id))
  .execute();
if (Number(progressCount[0].n) > 0) { set.status = 409; return { message: "module has trainee progress", code: "module_in_use" }; }
```

- [ ] **Step 3: Проверка живьём**

Смоук по DEPLOY.md-паттерну (throwaway порт + throwaway CREDIT_SOCKET_PATH, kill по PID). Прогнать: опубликовать модуль → unpublish → снова draft и редактируется; создать прогресс по теме → unpublish → 409 `module_in_use`; deactivate → модуль исчез из `GET /passport/modules` без флага и из `/me`; DELETE связи без прогресса → 200, с прогрессом → 409. Прибрать все тестовые строки (таблицы должны остаться пустыми).

- [ ] **Step 4: Commit**

```bash
cd /home/davr/managers && git add backend/drizzle/ backend/src/modules/passport/controller.ts backend/src/modules/passport/tg-controller.ts && git commit -m "feat(passport): unpublish, deactivate and unlink curriculum modules"
```

---

### Task B2: Backend — матрица прогресса и привязка наставников

**Files:**
- Modify: `backend/src/modules/passport/controller.ts`
- Modify: `backend/src/modules/passport/seed-permissions.ts` (+ прогон)

**Interfaces:**
- Produces:
  - `GET /passport/matrix?brand=&terminal_id=&position=&status=` (permission `passport.matrix.view`, terminal-scoped, HQ через `resolveIsHq`) → `{modules: [{id, title_ru, title_uz, sort}], rows: [{enrollment_id, employee: {id, first_name, last_name, position}, terminal_id, started_at, probation_deadline, cells: [{module_id, topics_total, topics_done, level_min, deadline_at, deadline_status}]}]}`. Уровни агрегируются по темам модуля; `deadline_status` считается тем же правилом, что в miniapp (`deadline.ts` — переиспользовать, не дублировать).
  - `GET /passport/enrollments/:id/journal` (permission `passport.matrix.view`, тот же terminal-скоуп) → страницы `passport_signoffs` по стажировке, свежие первыми, с раскрытыми именами акторов.
  - `GET /passport/mentors` и `POST /passport/mentors` (новая permission `passport.mentors.manage`, добавить в seed) — HR создаёт/снимает TG-привязку наставника: body `{user_id, telegram_id}` → строка в `passport_tg_bindings` c `user_id` (без `employee_id`). `DELETE /passport/mentors/:telegram_id` — снимает привязку. Это то, чего не хватает менеджеру, чтобы вообще войти в miniapp.
- Consumes: `deadlineStatus` из `backend/src/modules/passport/deadline.ts`.

- [ ] **Step 1: seed новой permission**

Добавить `{ slug: "passport.mentors.manage", description: "Passport: bind mentor telegram accounts" }` в `SLUGS`, прогнать скрипт, проверить идемпотентность (повторный прогон не плодит дублей).

- [ ] **Step 2: Матрица**

Один запрос на стажировки в скоупе, один на прогресс по ним, склейка в памяти (стажёров в филиале десятки, не тысячи — N+1 не нужен, но и мега-join не нужен). Пустой `terminals` у не-HQ → пустой результат (fail-closed, как в `GET /passport/enrollments`).

- [ ] **Step 3: Журнал и наставники**

`POST /passport/mentors` должен отказывать 409, если этот `telegram_id` уже привязан к стажёру (`employee_id` не null) — иначе повторится класс дефекта «перепривязка аккаунта», который чинили в 1a.

- [ ] **Step 4: Проверка живьём + Commit**

Смоук: матрица под HQ и под филиальным пользователем (второй видит только свои филиалы); журнал по чужой стажировке → 403; привязка наставника, повторная привязка чужого telegram_id → 409. Прибрать строки.

```bash
git add backend/src/modules/passport/ && git commit -m "feat(passport): progress matrix, enrollment journal, mentor bindings"
```

---

### Task B3: Frontend — каркас раздела, навигация, API-клиент

**Files:**
- Create: `admin/app/[locale]/passport/layout.tsx`, `admin/app/[locale]/passport/page.tsx`
- Create: `admin/lib/passport-api.ts`
- Modify: `admin/components/layout/nav-config.tsx`
- Modify: файлы переводов next-intl (те, что найдёте по `messages/`), секция `passport`

**Interfaces:**
- Produces: `admin/lib/passport-api.ts` — hand-typed клиент по структуре `admin/lib/credit-api.ts`: `const passportApi = (apiClient.api as any).passport;` плюс интерфейсы и по одной тонкой функции на эндпоинт, возвращающей `{data, error}`. Экспортировать: `listPrograms`, `createProgram`, `updateProgram`, `listModules`, `createModule`, `updateModule`, `submitModuleReview`, `publishModule`, `unpublishModule`, `deactivateModule`, `newModuleVersion`, `listTopics`, `createTopic`, `updateTopic`, `upsertProgramModule`, `deleteProgramModule`, `listEnrollments`, `createEnrollment`, `closeEnrollment`, `reinvite`, `getMatrix`, `getJournal`, `listMentors`, `createMentor`, `deleteMentor`.
- Раздел гейтится `passport_layout` (уже засеяно) в `nav-config.tsx`; layout копирует `app/[locale]/attestation/layout.tsx` со заменой слагов.

- [ ] **Step 1: API-клиент**

Прочитать `admin/lib/credit-api.ts` целиком и повторить его структуру. Типы полей брать из схемы (`backend/drizzle/schema.ts`), а не выдумывать. ВАЖНО: тела запросов у passport — плоские (`{title_ru, ...}`), не `{data: {...}}` как у attestation.

- [ ] **Step 2: Навигация + layout + заглушка страницы**

Группа «Паспорт стажёра» с пунктами: Куррикулум, Стажировки, Матрица, Наставники. `page.tsx` — редирект на «Куррикулум».

- [ ] **Step 3: Проверка сборки**

Run: `cd /home/davr/managers/admin && /root/.bun/bin/bun run build 2>&1 | tail -20`
Expected: сборка проходит. НЕ рестартить pm2 — это задача B8.

- [ ] **Step 4: Commit** — `git add admin/ && git commit -m "feat(passport-admin): section scaffold, nav entry and API client"`

---

### Task B4: Frontend — конструктор куррикулума

**Files:**
- Create: `admin/app/[locale]/passport/curriculum/page.tsx` + компоненты рядом (`_components/…`)

**Interfaces:**
- Consumes: `passport-api.ts` (B3), эндпоинты Плана 1a + B1.

Экран: слева дерево «Программа → Модули → Темы» (программа выбирается селектом), справа — редактор выбранного узла в **Sheet**. Обязательное:
- Двуязычные поля стоят **парами рядом** (RU | UZ-латиница) для: title, step, key_point, reason. Незаполненная пара визуально помечается — это то, что заблокирует публикацию.
- Кнопка «Опубликовать» показывает ошибки валидации из 422 `{errors}` списком, по-русски, с указанием темы.
- Опубликованный модуль показан замороженным: поля read-only, доступны «Снять с публикации» (B1), «Новая версия», «Деактивировать».
- Порядок тем — drag-sort через `@dnd-kit` (установлен, но в проекте не использован — это первая реализация; сортировку сохранять `PUT /passport/topics/:id` полем `sort`).
- Тип проверки темы — селект; для `dual` и `quiz_observation_photo` показать явное предупреждение «в текущем этапе такие темы нельзя подписать» (публикация их отклонит — так работает гейт после фикс-волны 1a).
- Департамент-скоуп виден: редактор не своего департамента не получает чужие модули (это backend, но UI не должен предлагать действия, которые вернут 403).

- [ ] **Step 1: Дерево + выбор программы** (TanStack Query, `Collapsible` из shadcn — tree-компонента в проекте нет).
- [ ] **Step 2: Редактор в Sheet** (@tanstack/react-form), двуязычные пары, сохранение.
- [ ] **Step 3: Публикация/снятие/версия/деактивация** + отрисовка ошибок 422.
- [ ] **Step 4: Drag-sort тем** через @dnd-kit (`DndContext` + `SortableContext` + `arrayMove`, персист по отпусканию).
- [ ] **Step 5: Сборка** — `bun run build`, без pm2.
- [ ] **Step 6: Commit** — `git commit -m "feat(passport-admin): bilingual curriculum builder"`

---

### Task B5: Frontend — стажировки и QR-инвайт

**Files:**
- Create: `admin/app/[locale]/passport/enrollments/page.tsx`, `data-table.tsx`, `_components/…`
- Modify: `admin/package.json` (+ библиотека генерации QR)

**Interfaces:** consumes `listEnrollments`, `createEnrollment`, `closeEnrollment`, `reinvite`, `getJournal`.

- QR-генератора в проекте НЕТ (`html5-qrcode` — только сканер). Поставить лёгкий генератор (например `qrcode.react`), зафиксировать версию в `package.json`.
- Таблица стажировок: сотрудник, позиция, филиал, программа, старт, дедлайн испытательного (с цветом), статус. Скоуп по филиалам делает backend.
- «Начать стажировку» — Sheet: выбор сотрудника (поиск по реестру `employees`), программы, срок испытательного в днях. Ответ содержит `invite_id`.
- **Экран печати инвайта**: QR кодирует `https://t.me/pasport_stajer_bot?startapp=inv_<invite_id>`, рядом крупно имя стажёра, программа, срок действия инвайта (7 дней) и короткая инструкция по-русски и по-узбекски (латиница). Кнопка «Печать» — печатная вёрстка (`@media print`), одна страница A4/A5.
- «Перевыпустить инвайт» и «Завершить стажировку» — с подтверждением; после reinvite старый QR перестаёт работать, это сказать пользователю прямо в подтверждении.
- Карточка стажёра — журнал (`getJournal`) как таймлайн: действие, кто, когда, филиал.

- [ ] **Step 1: Установка QR-библиотеки** (`cd admin && bun add …`), фиксация версии, сборка проходит.
- [ ] **Step 2: Таблица + фильтры** (копировать `attestation/tests/data-table.tsx`, `manualPagination` против `{total, data}`).
- [ ] **Step 3: Создание стажировки** (Sheet + react-form).
- [ ] **Step 4: Печать QR-инвайта** (+ печатные стили).
- [ ] **Step 5: Reinvite/close + журнал-таймлайн.**
- [ ] **Step 6: Сборка + Commit** — `git commit -m "feat(passport-admin): enrollments, printable QR invites, journal"`

---

### Task B6: Frontend — матрица прогресса и наставники

**Files:**
- Create: `admin/app/[locale]/passport/matrix/page.tsx` + компоненты
- Create: `admin/app/[locale]/passport/mentors/page.tsx`

**Interfaces:** consumes `getMatrix` (B2), `listMentors`/`createMentor`/`deleteMentor` (B2).

Матрица (главный экран для HR, дизайн-направление — из dribbble-референсов):
- Сверху компактная полоса метрик: активных стажировок, просрочено модулей, ждут наблюдения, завершено за 30 дней.
- Сетка: строки — стажёры (имя, позиция, филиал), колонки — модули программы; ячейка — чип уровня с цветом (1 серый / 2 янтарный / 3 зелёный / 4 акцент) и подписью «сделано/всего тем»; просроченный дедлайн — красная рамка ячейки.
- Фильтры: бренд, филиал, позиция, статус. Горизонтальный скролл внутри контейнера (`overflow-x: auto`), страница вбок не едет.
- Клик по ячейке — Sheet с журналом по этой стажировке (`getJournal`).
- Пусто — честная пустая заглушка («стажировок пока нет»), а не бесконечный скелетон.

Наставники: таблица привязок + форма привязки менеджера к Telegram ID + снятие привязки. Пояснить в UI, где менеджер берёт свой Telegram ID.

- [ ] **Step 1: Матрица — запрос, полоса метрик, сетка с чипами.**
- [ ] **Step 2: Фильтры + горизонтальный скролл + пустые состояния.**
- [ ] **Step 3: Sheet с журналом по клику на ячейку.**
- [ ] **Step 4: Страница наставников.**
- [ ] **Step 5: Сборка + Commit** — `git commit -m "feat(passport-admin): progress matrix and mentor bindings"`

---

### Task B7: Проверка интерфейса в браузере

**Files:** нет (проверка). Скриншоты — в `/tmp/passport-ui/`.

**Стенд (собрать именно так, иначе проверка ничего не докажет):**
- Прод-бинарь `backend/app` собран 2026-08-09 и НЕ содержит роутов 1b — админка, направленная в прод-API, получит 404 на половине экранов. Поэтому поднять **свой бэкенд из исходников**: throwaway порт, throwaway `CREDIT_SOCKET_PATH`, throwaway `PROJECT_PREFIX` (чтобы синтетические сессии и кэш ролей не попали в прод-ключи Redis).
- Админка: `TRPC_API_URL=http://127.0.0.1:<порт бэкенда> PORT=<свой порт> bun start`. Переменная читается на рантайме и она же питает `next.config.js` rewrites (`/api/:path*` → бэкенд), а браузер бьёт в свой же origin — значит подмена базового URL достаточна, пересборка не нужна.
- Браузер: на сервере уже есть Chrome и `puppeteer` (в `merchants_api/node_modules`) — использовать их для реальных кликов и скриншотов. Куку сессии ставить через `page.setCookie`.
- Роль для прогона: синтетическая, с правами `passport_layout`, `passport.curriculum.edit`, `passport.curriculum.publish`, `passport.enrollments.manage`, `passport.matrix.view`, `passport.mentors.manage`, `users.list`, `employees.list`. Всё под throwaway-префиксом.

**Сценарий:** создать программу → модуль → две темы (RU+UZ) → перетащить тему (проверить, что порядок сохранился) → публикация с пустым uz (ожидать список ошибок) → заполнить → опубликовать → снять с публикации → начать стажировку → открыть печать QR (проверить предпросмотр печати и что код не пустой) → матрица (ячейка → журнал) → страница наставников.

**Проверить отдельно то, что до сих пор никто не прогонял вживую:** `DELETE /program-modules` с телом, реальный 422 публикации, блок 409 `module_in_use`, сохранение порядка тем (PUT), журнал при переключении между стажёрами (не должен показывать чужие записи).

- [ ] **Step 1:** Запустить `bun run start` (или dev) на throwaway-порту, PID захватить.
- [ ] **Step 2:** Пройти сценарий, снять скриншоты ключевых экранов в `/tmp/passport-ui/`.
- [ ] **Step 3:** Прибрать: убить по PID, удалить тестовые строки, скриншоты оставить.
- [ ] **Step 4:** Отчёт: что работает, что выглядит сломанным, что осталось.

---

### Task B8: Деплой (backend + admin)

**Files:** `backend/app` (бинарь, вне git), pm2-процессы

Едет вместе: незадеплоенный коммит `f0fa714` (фикс-волна 1a) + всё из B1–B6.

- [ ] **Step 1:** Полный прогон тестов: `cd backend && /root/.bun/bin/bun test src/modules/passport/` — все зелёные.
- [ ] **Step 2:** Backend по `backend/DEPLOY.md`: бэкап `app` с меткой времени → `bun build --compile` в `app.new` → смоук на throwaway-порту с throwaway `CREDIT_SOCKET_PATH` (короткое окно!) → проверить `/api/passport/matrix` = 401, `/` = 200, credit-сокет отвечает → убить по PID (проверить, что не осталось orphan-слушателей: бинарь re-exec'ится) → `mv app.new app` → `pm2 restart office_api`.
- [ ] **Step 3:** Admin: `cd admin && bun run build` → `pm2 restart` процесса админки (имя из env `PM2_APP_NAME`; посмотреть в `pm2 list`).
- [ ] **Step 4:** Постпроверка: office.lesailes.uz открывается и логинится; раздел «Паспорт стажёра» НЕ виден обычному пользователю (прав нет ни у кого — так и задумано); старые разделы (отчёты, аттестация, timesheet) работают; `curl https://api.office.lesailes.uz/api/passport/matrix` → 401; логи pm2 обоих процессов без новых ошибок.
- [ ] **Step 5:** При любой поломке — откат: вернуть бэкап бинаря, `pm2 restart office_api`, проверить, доложить.
- [ ] **Step 6:** Зафиксировать в отчёте пути отката и факт, что деплой снова стоил окна недоступности (~30 с на бэкенде).

---

## Вне плана 1b

- План 1c: miniapp паспорта (стажёр + наставник) — форк `les_training_miniapp`, дизайн через `aesthetic`/`design-taste-frontend`, бот и пуши.
- Этап 2: QR-рукопожатие, киоск-экзамены модулей, фото-темы, штампы универсалов, `dual` вторая подпись.
- Этап 3: детектор аномалий, генератор случайных ре-проверок, рейтинг наставников, лента честности.
- Не забыть: включение фичи (гранты прав) — по runbook из финального ревью 1a, не раньше B8.

## Self-review

- Покрытие: блокер «нет unpublish» → B1; отсутствующие backend-роуты матрицы/наставников (найдено разведкой) → B2; фронт-каркас/клиент → B3; конструктор двуязычный + dnd → B4; стажировки и QR (библиотеки нет — ставим) → B5; матрица и наставники → B6; живая проверка → B7; деплой вместе с висящим `f0fa714` → B8.
- Плейсхолдеров нет; каждая задача заканчивается проверяемым результатом и коммитом.
- Согласованность имён: функции `passport-api.ts` из B3 используются в B4–B6 под теми же именами; `deadlineStatus` переиспользуется, не дублируется.
