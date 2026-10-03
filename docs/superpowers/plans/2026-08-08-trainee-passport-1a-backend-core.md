# Trainee Passport — Plan 1a: Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend-ядро паспорта стажёра в office_api: схема, права, CRUD куррикулума с департамент-скоупом, публикация с валидацией двух языков, стажировки+инвайты, TG-auth, эндпоинты стажёра (материал/квиз через attestation-движок) и простая подпись наставника.

**Architecture:** Новый модуль `passport` в монорепо `/home/davr/managers` (Elysia + Drizzle + Postgres `managers`). Квизы = существующий attestation-движок (`source='miniapp'`). Стейт-машина уровней — чистые функции с юнит-тестами. Append-only журнал `passport_signoffs` — источник правды, `passport_topic_progress` — проекция.

**Tech Stack:** Bun, Elysia, Drizzle ORM (drizzle-kit), PostgreSQL, Redis (сессии), bun test.

## Global Constraints

- Спека: `/home/davr/managers/docs/superpowers/specs/2026-08-08-trainee-passport-design.md` — все решения оттуда.
- Работа НА СЕРВЕРЕ `choparpizza.uz` в `/home/davr/managers` (паттерн проекта; локального клона нет). Коммиты в git после каждой задачи.
- Прод-бинарь: `pm2 restart office_api` БЕЗ пересборки бинаря `backend/app` ничего не деплоит. Деплой строго по `backend/DEPLOY.md` (backup бинаря → `bun build --compile` в `app.new` → smoke на throwaway-порту И throwaway `CREDIT_SOCKET_PATH` (иначе уводит прод-сокет Laravel!), окно смоука короткое (dev-boot запускает credit-jobs против прод-Redis) → `kill` смоука → `mv app.new app` → `pm2 restart office_api`).
- Схема Drizzle — ТОЛЬКО в `backend/drizzle/schema.ts` (не в src/). Миграции: `cd backend && bunx drizzle-kit generate && bunx drizzle-kit migrate`.
- Новый контроллер обязан быть зарегистрирован в `backend/src/controllers.ts`, иначе роуты не поднимутся.
- Все контентные поля двуязычные: `*_ru` (русский) и `*_uz` (узбекская ЛАТИНИЦА).
- Права — слаги через seed-скрипт (паттерн `attestation/seed-permissions.ts`): `passport.curriculum.edit`, `passport.curriculum.publish`, `passport.signoff`, `passport.enrollments.manage`, `passport.matrix.view`, `passport_layout`.
- Тесты: `cd /home/davr/managers/backend && bun test src/modules/passport/` — прогон перед каждым коммитом.
- Никаких Date.now-зависимых недетерминированных тестов: время передавать параметром.

---

### Task 0: Ночной pg_dump бэкап Postgres `managers` (пререквизит №0 спеки)

**Files:**
- Create: `/root/bin/pg_backup_managers.sh` (на сервере)
- Modify: crontab root

**Interfaces:**
- Produces: ежедневные дампы `/var/backups/postgres/managers_YYYY-MM-DD.sql.gz`, ротация 14 дней.

- [ ] **Step 1: Скрипт бэкапа**

```bash
mkdir -p /var/backups/postgres
cat > /root/bin/pg_backup_managers.sh <<'EOF'
#!/bin/bash
set -euo pipefail
OUT=/var/backups/postgres
sudo -u postgres pg_dump managers | gzip > "$OUT/managers_$(date +%F).sql.gz.tmp"
mv "$OUT/managers_$(date +%F).sql.gz.tmp" "$OUT/managers_$(date +%F).sql.gz"
find "$OUT" -name 'managers_*.sql.gz' -mtime +14 -delete
EOF
chmod +x /root/bin/pg_backup_managers.sh
```

- [ ] **Step 2: Прогнать вручную, проверить дамп**

Run: `/root/bin/pg_backup_managers.sh && ls -la /var/backups/postgres/ && zcat /var/backups/postgres/managers_$(date +%F).sql.gz | head -5`
Expected: файл >1MB, шапка `-- PostgreSQL database dump`.

- [ ] **Step 3: Крон 04:15 ежедневно**

```bash
(crontab -l 2>/dev/null; echo "15 4 * * * /root/bin/pg_backup_managers.sh >> /var/log/pg_backup_managers.log 2>&1") | crontab -
crontab -l | grep pg_backup
```

---

### Task 1: Схема Drizzle — все passport-таблицы + `source` в попытках аттестации

**Files:**
- Modify: `backend/drizzle/schema.ts` (append в конец)
- Create (генерится): `backend/drizzle/migrations/00XX_*.sql`

**Interfaces:**
- Produces: экспорты `passport_programs, passport_modules, passport_program_modules, passport_topics, passport_enrollments, passport_invites, passport_tg_bindings, passport_topic_progress, passport_signoffs, passport_stamps, passport_qr_tokens, passport_rechecks, passport_flags, passport_media`; енамы `passport_module_status, passport_verification_type, passport_enrollment_status, passport_signoff_action, passport_stamp_type`; колонка `attestation_test_attempts.source`.

- [ ] **Step 1: Дописать схему в `backend/drizzle/schema.ts`**

```ts
// ===================== TRAINEE PASSPORT =====================
export const passport_module_status = pgEnum("passport_module_status", ["draft", "review", "published"]);
export const passport_verification_type = pgEnum("passport_verification_type", ["quiz", "observation", "quiz_observation", "quiz_observation_photo", "dual"]);
export const passport_enrollment_status = pgEnum("passport_enrollment_status", ["active", "completed", "failed", "paused"]);
export const passport_signoff_action = pgEnum("passport_signoff_action", ["material_opened", "quiz_passed", "quiz_failed", "observed", "observation_declined", "recheck_passed", "recheck_failed", "level_set", "level_rolled_back", "stamp_issued"]);
export const passport_stamp_type = pgEnum("passport_stamp_type", ["module_cert", "universal_chopar", "universal_les", "probation_passed"]);

export const passport_programs = pgTable("passport_programs", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  position: varchar("position", { length: 100 }).notNull(),
  title_ru: varchar("title_ru", { length: 255 }).notNull(),
  title_uz: varchar("title_uz", { length: 255 }).notNull(),
  active: boolean("active").default(true).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const passport_modules = pgTable("passport_modules", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  title_ru: varchar("title_ru", { length: 255 }).notNull(),
  title_uz: varchar("title_uz", { length: 255 }).default("").notNull(),
  brand: varchar("brand", { length: 20 }), // null | 'chopar' | 'les'
  owner_department: varchar("owner_department", { length: 50 }).notNull(),
  status: passport_module_status("status").default("draft").notNull(),
  version: integer("version").default(1).notNull(),
  exam_test_id: uuid("exam_test_id"), // -> attestation_tests
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const passport_program_modules = pgTable("passport_program_modules", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  program_id: uuid("program_id").notNull().references(() => passport_programs.id),
  module_id: uuid("module_id").notNull().references(() => passport_modules.id),
  sort: integer("sort").default(0).notNull(),
  required: boolean("required").default(true).notNull(),
  deadline_days: integer("deadline_days"),
}, (t) => [uniqueIndex("UQ_passport_prog_mod").on(t.program_id, t.module_id)]);

export const passport_topics = pgTable("passport_topics", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  module_id: uuid("module_id").notNull().references(() => passport_modules.id),
  sort: integer("sort").default(0).notNull(),
  title_ru: varchar("title_ru", { length: 255 }).notNull(),
  title_uz: varchar("title_uz", { length: 255 }).default("").notNull(),
  step_ru: text("step_ru").default("").notNull(),
  step_uz: text("step_uz").default("").notNull(),
  key_point_ru: text("key_point_ru").default("").notNull(),
  key_point_uz: text("key_point_uz").default("").notNull(),
  reason_ru: text("reason_ru").default("").notNull(),
  reason_uz: text("reason_uz").default("").notNull(),
  video_id: uuid("video_id"), // -> passport_media
  verification_type: passport_verification_type("verification_type").default("quiz_observation").notNull(),
  quiz_test_id: uuid("quiz_test_id"), // -> attestation_tests
  observation_checklist: jsonb("observation_checklist"), // {items:[{ru,uz}], questions:[{ru,uz}]}
  active: boolean("active").default(true).notNull(),
});

export const passport_enrollments = pgTable("passport_enrollments", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  employee_id: uuid("employee_id").notNull().references(() => employees.id),
  program_id: uuid("program_id").notNull().references(() => passport_programs.id),
  terminal_id: uuid("terminal_id").notNull(),
  status: passport_enrollment_status("status").default("active").notNull(),
  started_at: timestamp("started_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  probation_deadline: timestamp("probation_deadline", { withTimezone: true, mode: "string" }),
  completed_at: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  created_by_user_id: uuid("created_by_user_id").notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const passport_invites = pgTable("passport_invites", {
  id: uuid("id").defaultRandom().primaryKey().notNull(), // сам токен инвайта
  enrollment_id: uuid("enrollment_id").notNull().references(() => passport_enrollments.id),
  created_by_user_id: uuid("created_by_user_id").notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  used_at: timestamp("used_at", { withTimezone: true, mode: "string" }),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const passport_tg_bindings = pgTable("passport_tg_bindings", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  telegram_id: bigint("telegram_id", { mode: "number" }).notNull(),
  employee_id: uuid("employee_id").references(() => employees.id), // стажёр
  user_id: uuid("user_id"), // наставник/аудитор -> users
  first_name: varchar("first_name", { length: 255 }).default("").notNull(),
  lang: varchar("lang", { length: 2 }).default("ru").notNull(), // ru | uz
  banned: boolean("banned").default(false).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (t) => [uniqueIndex("UQ_passport_tg").on(t.telegram_id)]);

export const passport_topic_progress = pgTable("passport_topic_progress", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  enrollment_id: uuid("enrollment_id").notNull().references(() => passport_enrollments.id),
  topic_id: uuid("topic_id").notNull().references(() => passport_topics.id),
  level: integer("level").default(0).notNull(), // 0..4
  quiz_attempt_id: uuid("quiz_attempt_id"),
  observed_by_user_id: uuid("observed_by_user_id"),
  observed_at: timestamp("observed_at", { withTimezone: true, mode: "string" }),
  observation_answers: jsonb("observation_answers"),
  photo_path: varchar("photo_path", { length: 500 }),
  recheck_due_at: timestamp("recheck_due_at", { withTimezone: true, mode: "string" }),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (t) => [uniqueIndex("UQ_passport_progress").on(t.enrollment_id, t.topic_id)]);

export const passport_signoffs = pgTable("passport_signoffs", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  enrollment_id: uuid("enrollment_id").notNull().references(() => passport_enrollments.id),
  topic_id: uuid("topic_id"),
  module_id: uuid("module_id"),
  action: passport_signoff_action("action").notNull(),
  actor_user_id: uuid("actor_user_id"),
  actor_employee_id: uuid("actor_employee_id"),
  terminal_id: uuid("terminal_id"),
  ip: varchar("ip", { length: 64 }),
  meta: jsonb("meta"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (t) => [index("IX_passport_signoffs_enr").on(t.enrollment_id, t.created_at)]);

export const passport_stamps = pgTable("passport_stamps", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  enrollment_id: uuid("enrollment_id").notNull().references(() => passport_enrollments.id),
  employee_id: uuid("employee_id").notNull(),
  type: passport_stamp_type("type").notNull(),
  module_id: uuid("module_id"),
  issued_by_user_id: uuid("issued_by_user_id"), // null = автомат
  manual_comment: text("manual_comment"),
  valid_until: timestamp("valid_until", { withTimezone: true, mode: "string" }),
  issued_at: timestamp("issued_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const passport_qr_tokens = pgTable("passport_qr_tokens", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  enrollment_id: uuid("enrollment_id").notNull(),
  topic_id: uuid("topic_id").notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  used_at: timestamp("used_at", { withTimezone: true, mode: "string" }),
  used_by_user_id: uuid("used_by_user_id"),
  trainee_ip: varchar("trainee_ip", { length: 64 }),
});

export const passport_rechecks = pgTable("passport_rechecks", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  topic_progress_id: uuid("topic_progress_id").notNull().references(() => passport_topic_progress.id),
  assigned_to_user_id: uuid("assigned_to_user_id").notNull(),
  origin: varchar("origin", { length: 10 }).default("random").notNull(), // random | manual
  due_at: timestamp("due_at", { withTimezone: true, mode: "string" }).notNull(),
  result: varchar("result", { length: 10 }), // null | passed | failed
  resolved_at: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const passport_flags = pgTable("passport_flags", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  subject_user_id: uuid("subject_user_id"),
  enrollment_id: uuid("enrollment_id"),
  meta: jsonb("meta"),
  resolved: boolean("resolved").default(false).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const passport_media = pgTable("passport_media", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  title: varchar("title", { length: 255 }).default("").notNull(),
  file_path: varchar("file_path", { length: 500 }).notNull(),
  status: varchar("status", { length: 20 }).default("ready").notNull(),
  transcode_error: text("transcode_error"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});
```

И в существующую `attestation_test_attempts` добавить строку после `question_ids`:

```ts
  source: varchar("source", { length: 10 }).default("kiosk").notNull(), // kiosk | miniapp
```

- [ ] **Step 2: Сгенерировать и применить миграцию**

Run: `cd /home/davr/managers/backend && bunx drizzle-kit generate && bunx drizzle-kit migrate`
Expected: новая миграция `00XX_*.sql` создана и применена без ошибок.

- [ ] **Step 3: Проверить таблицы в БД**

Run: `sudo -u postgres psql managers -c "\dt passport_*" && sudo -u postgres psql managers -c "\d attestation_test_attempts" | grep source`
Expected: 14 таблиц passport_*, колонка source default 'kiosk'.

- [ ] **Step 4: Commit**

```bash
cd /home/davr/managers && git add backend/drizzle/ && git commit -m "feat(passport): schema for trainee passport + attempt source column"
```

---

### Task 2: Seed прав passport

**Files:**
- Create: `backend/src/modules/passport/seed-permissions.ts`

**Interfaces:**
- Produces: слаги в таблице permissions: `passport.curriculum.edit`, `passport.curriculum.publish`, `passport.signoff`, `passport.enrollments.manage`, `passport.matrix.view`, `passport.recheck`, `passport.level4.grant`, `passport_layout`.

- [ ] **Step 1: Скрипт по образцу attestation/seed-permissions.ts**

```ts
import { drizzleDb } from "../../lib/db";
import { permissions } from "backend/drizzle/schema";
import { eq } from "drizzle-orm";

const SLUGS: { slug: string; description: string }[] = [
  { slug: "passport.curriculum.edit", description: "Passport: edit own-department curriculum" },
  { slug: "passport.curriculum.publish", description: "Passport: review + publish curriculum (HR)" },
  { slug: "passport.signoff", description: "Passport: sign trainee observations (mentor)" },
  { slug: "passport.enrollments.manage", description: "Passport: start/close enrollments, invites (HR)" },
  { slug: "passport.matrix.view", description: "Passport: view progress matrix" },
  { slug: "passport.recheck", description: "Passport: perform rechecks (audit)" },
  { slug: "passport.level4.grant", description: "Passport: grant level 4 (can teach)" },
  { slug: "passport_layout", description: "Passport: top-level admin layout" },
];

async function main() {
  for (const s of SLUGS) {
    const existing = await drizzleDb.select({ id: permissions.id }).from(permissions)
      .where(eq(permissions.slug, s.slug)).execute();
    if (existing.length === 0) {
      await drizzleDb.insert(permissions).values({ slug: s.slug, description: s.description, active: true }).execute();
      console.log("created", s.slug);
    } else {
      console.log("exists", s.slug);
    }
  }
  process.exit(0);
}
main();
```

(Перед запуском свериться с реальными колонками `permissions` в schema.ts — если поле называется иначе, чем `slug`/`description`/`active`, скопировать точный insert из attestation/seed-permissions.ts.)

- [ ] **Step 2: Запустить и проверить**

Run: `cd /home/davr/managers/backend && bun run src/modules/passport/seed-permissions.ts && sudo -u postgres psql managers -t -c "select slug from permissions where slug like 'passport%'"`
Expected: 8 слагов.

- [ ] **Step 3: Commit**

```bash
cd /home/davr/managers && git add backend/src/modules/passport/ && git commit -m "feat(passport): seed permissions"
```

---

### Task 3: Стейт-машина уровней (чистые функции + тесты)

**Files:**
- Create: `backend/src/modules/passport/state.ts`
- Test: `backend/src/modules/passport/state.test.ts`

**Interfaces:**
- Produces:
  - `type VerificationType = "quiz" | "observation" | "quiz_observation" | "quiz_observation_photo" | "dual"`
  - `hasQuiz(vt: VerificationType): boolean`, `hasObservation(vt: VerificationType): boolean`, `needsPhoto(vt: VerificationType): boolean`
  - `levelAfterMaterialOpened(current: number): number` — max(current, 1)
  - `levelAfterQuizPassed(current: number, vt: VerificationType): number` — если vt без наблюдения → max(current,3), иначе max(current,2)
  - `canObserve(current: number, vt: VerificationType): boolean` — наблюдение допустимо с уровня ≥2 при наличии квиза, с ≥1 без квиза
  - `levelAfterObserved(current: number): number` — max(current, 3)
  - `levelAfterRecheckFailed(): number` — 2
  - `observationComplete(checklist: {items: unknown[]; questions: unknown[]}, answers: {items: boolean[]; questions: boolean[]}): boolean` — все пункты И все вопросы true, длины совпадают

- [ ] **Step 1: Написать падающие тесты**

```ts
import { describe, expect, test } from "bun:test";
import {
  levelAfterMaterialOpened, levelAfterQuizPassed, canObserve,
  levelAfterObserved, levelAfterRecheckFailed, observationComplete, hasQuiz,
} from "./state";

describe("passport level state machine", () => {
  test("material opened: 0 -> 1, never lowers", () => {
    expect(levelAfterMaterialOpened(0)).toBe(1);
    expect(levelAfterMaterialOpened(3)).toBe(3);
  });
  test("quiz passed with observation type -> 2", () => {
    expect(levelAfterQuizPassed(1, "quiz_observation")).toBe(2);
  });
  test("quiz passed on quiz-only topic -> 3", () => {
    expect(levelAfterQuizPassed(1, "quiz")).toBe(3);
  });
  test("observe allowed from 2 when quiz required, from 1 when not", () => {
    expect(canObserve(1, "quiz_observation")).toBe(false);
    expect(canObserve(2, "quiz_observation")).toBe(true);
    expect(canObserve(1, "observation")).toBe(true);
  });
  test("observed -> 3; recheck fail -> 2", () => {
    expect(levelAfterObserved(2)).toBe(3);
    expect(levelAfterRecheckFailed()).toBe(2);
  });
  test("observationComplete requires every tick", () => {
    const cl = { items: [{}, {}], questions: [{}] };
    expect(observationComplete(cl, { items: [true, true], questions: [true] })).toBe(true);
    expect(observationComplete(cl, { items: [true, false], questions: [true] })).toBe(false);
    expect(observationComplete(cl, { items: [true], questions: [true] })).toBe(false);
  });
  test("hasQuiz mapping", () => {
    expect(hasQuiz("observation")).toBe(false);
    expect(hasQuiz("dual")).toBe(true);
  });
});
```

- [ ] **Step 2: Убедиться, что падают**

Run: `cd /home/davr/managers/backend && bun test src/modules/passport/state.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Реализация**

```ts
export type VerificationType = "quiz" | "observation" | "quiz_observation" | "quiz_observation_photo" | "dual";

export const hasQuiz = (vt: VerificationType) => vt !== "observation";
export const hasObservation = (vt: VerificationType) => vt !== "quiz";
export const needsPhoto = (vt: VerificationType) => vt === "quiz_observation_photo";

export const levelAfterMaterialOpened = (current: number) => Math.max(current, 1);

export const levelAfterQuizPassed = (current: number, vt: VerificationType) =>
  hasObservation(vt) ? Math.max(current, 2) : Math.max(current, 3);

export const canObserve = (current: number, vt: VerificationType) =>
  hasObservation(vt) && current >= (hasQuiz(vt) ? 2 : 1);

export const levelAfterObserved = (current: number) => Math.max(current, 3);
export const levelAfterRecheckFailed = () => 2;

export const observationComplete = (
  checklist: { items: unknown[]; questions: unknown[] },
  answers: { items: boolean[]; questions: boolean[] }
): boolean =>
  answers.items.length === checklist.items.length &&
  answers.questions.length === checklist.questions.length &&
  answers.items.every(Boolean) &&
  answers.questions.every(Boolean);
```

- [ ] **Step 4: Тесты зелёные**

Run: `bun test src/modules/passport/state.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/davr/managers && git add backend/src/modules/passport/state* && git commit -m "feat(passport): level state machine with tests"
```

---

### Task 4: Валидация публикации (оба языка) — чистая функция + тесты

**Files:**
- Create: `backend/src/modules/passport/publish-validation.ts`
- Test: `backend/src/modules/passport/publish-validation.test.ts`

**Interfaces:**
- Produces: `validateModuleForPublish(mod: {title_ru: string; title_uz: string}, topics: Array<{title_ru: string; title_uz: string; step_ru: string; step_uz: string; key_point_ru: string; key_point_uz: string; reason_ru: string; reason_uz: string; verification_type: string; quiz_test_id: string | null; observation_checklist: unknown}>): string[]` — список ошибок, пустой = можно публиковать.

- [ ] **Step 1: Падающие тесты**

```ts
import { describe, expect, test } from "bun:test";
import { validateModuleForPublish } from "./publish-validation";

const okTopic = {
  title_ru: "ФИФО", title_uz: "FIFO", step_ru: "ш", step_uz: "s",
  key_point_ru: "к", key_point_uz: "k", reason_ru: "п", reason_uz: "p",
  verification_type: "quiz_observation", quiz_test_id: "11111111-1111-1111-1111-111111111111",
  observation_checklist: { items: [{ ru: "нож", uz: "pichoq" }], questions: [{ ru: "зачем?", uz: "nega?" }] },
};

describe("publish validation", () => {
  test("ok module passes", () => {
    expect(validateModuleForPublish({ title_ru: "Кухня", title_uz: "Oshxona" }, [okTopic])).toEqual([]);
  });
  test("missing uz title blocks", () => {
    const errs = validateModuleForPublish({ title_ru: "Кухня", title_uz: "" }, [okTopic]);
    expect(errs.length).toBeGreaterThan(0);
  });
  test("quiz type without quiz_test_id blocks", () => {
    const errs = validateModuleForPublish({ title_ru: "К", title_uz: "K" },
      [{ ...okTopic, quiz_test_id: null }]);
    expect(errs.some((e) => e.includes("quiz"))).toBe(true);
  });
  test("observation type without checklist blocks", () => {
    const errs = validateModuleForPublish({ title_ru: "К", title_uz: "K" },
      [{ ...okTopic, verification_type: "observation", observation_checklist: null }]);
    expect(errs.some((e) => e.includes("checklist"))).toBe(true);
  });
  test("observation checklist without questions array blocks", () => {
    const errs = validateModuleForPublish({ title_ru: "К", title_uz: "K" },
      [{ ...okTopic, observation_checklist: { items: [{ ru: "нож", uz: "pichoq" }] } }]);
    expect(errs.some((e) => e.includes("questions"))).toBe(true);
  });
  test("topic-level uz field missing blocks", () => {
    const errs = validateModuleForPublish({ title_ru: "К", title_uz: "K" },
      [{ ...okTopic, key_point_uz: "   " }]);
    expect(errs.some((e) => e.includes("key_point"))).toBe(true);
  });
  test("module without topics blocks", () => {
    expect(validateModuleForPublish({ title_ru: "К", title_uz: "K" }, []).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: FAIL прогон** — `bun test src/modules/passport/publish-validation.test.ts` → module not found.

- [ ] **Step 3: Реализация**

```ts
import { hasQuiz, hasObservation, type VerificationType } from "./state";

type TopicInput = {
  title_ru: string; title_uz: string; step_ru: string; step_uz: string;
  key_point_ru: string; key_point_uz: string; reason_ru: string; reason_uz: string;
  verification_type: string; quiz_test_id: string | null; observation_checklist: unknown;
};

const PAIRS: Array<[keyof TopicInput, keyof TopicInput, string]> = [
  ["title_ru", "title_uz", "title"],
  ["step_ru", "step_uz", "step"],
  ["key_point_ru", "key_point_uz", "key_point"],
  ["reason_ru", "reason_uz", "reason"],
];

export function validateModuleForPublish(
  mod: { title_ru: string; title_uz: string },
  topics: TopicInput[]
): string[] {
  const errors: string[] = [];
  if (!mod.title_ru.trim() || !mod.title_uz.trim()) errors.push("module: title_ru/title_uz required");
  if (topics.length === 0) errors.push("module: no topics");
  topics.forEach((t, i) => {
    for (const [ru, uz, name] of PAIRS) {
      if (!String(t[ru] ?? "").trim() || !String(t[uz] ?? "").trim())
        errors.push(`topic ${i + 1}: ${name} required in both languages`);
    }
    const vt = t.verification_type as VerificationType;
    if (hasQuiz(vt) && !t.quiz_test_id) errors.push(`topic ${i + 1}: quiz_test_id required for quiz type`);
    if (hasObservation(vt)) {
      const cl = t.observation_checklist as { items?: unknown[]; questions?: unknown[] } | null;
      if (!cl || !Array.isArray(cl.items) || cl.items.length === 0)
        errors.push(`topic ${i + 1}: observation_checklist items required`);
      // questions may be empty, but the key MUST exist as an array: observationComplete()
      // in state.ts dereferences checklist.questions.length unconditionally.
      if (!cl || !Array.isArray(cl.questions))
        errors.push(`topic ${i + 1}: observation_checklist questions must be an array`);
    }
  });
  return errors;
}
```

- [ ] **Step 4: PASS прогон** — `bun test src/modules/passport/publish-validation.test.ts` → 7 tests pass.

- [ ] **Step 5: Commit** — `git add backend/src/modules/passport/publish-validation* && git commit -m "feat(passport): publish validation (both languages)"`

---

### Task 5: Контроллер куррикулума (CRUD + департамент-скоуп + publish)

**Files:**
- Create: `backend/src/modules/passport/controller.ts`
- Modify: `backend/src/controllers.ts` (import + `.use(passportController)`)
- Modify: `backend/drizzle/schema.ts` — в таблицу `users` добавить `department: varchar("department", { length: 50 })` (+ миграция)

**Interfaces:**
- Consumes: `ctx` permission-макрос; `validateModuleForPublish` (Task 4); таблицы Task 1.
- Produces (все под cookie-auth, префикс приложения как у остальных модулей):
  - `GET /passport/programs` (permission `passport.matrix.view`) — list.
  - `POST /passport/programs`, `PUT /passport/programs/:id` (permission `passport.curriculum.publish`) — body `{position, title_ru, title_uz, active?}`.
  - `GET /passport/modules?program_id=` (permission `passport.curriculum.edit`) — HR (роль admin или право publish) видит все; иначе фильтр `owner_department = user.department`.
  - `POST /passport/modules`, `PUT /passport/modules/:id` (permission `passport.curriculum.edit`) — редактирование чужого департамента → 403; модуль в статусе `published` редактировать нельзя → 409 (сначала «новая версия»: POST `/passport/modules/:id/new-version` копирует модуль+темы в draft, version+1).
  - `POST /passport/modules/:id/submit-review` (edit) — draft → review.
  - `POST /passport/modules/:id/publish` (permission `passport.curriculum.publish`) — прогоняет `validateModuleForPublish`; ошибки → 422 `{errors}`; успех → status published.
  - CRUD тем: `GET /passport/modules/:id/topics`, `POST /passport/topics`, `PUT /passport/topics/:id` (edit, тот же департамент-скоуп через модуль; published-модуль → 409).
  - `POST /passport/program-modules` upsert привязки `{program_id, module_id, sort, required, deadline_days}` (permission `passport.curriculum.publish`).

- [ ] **Step 1: Миграция users.department**

В schema.ts к `users` добавить `department: varchar("department", { length: 50 }),`; `bunx drizzle-kit generate && bunx drizzle-kit migrate`.

- [ ] **Step 2: Каркас контроллера с одним эндпоинтом (programs list) по паттерну attestation**

```ts
import { ctx } from "@backend/context";
import {
  passport_programs, passport_modules, passport_program_modules, passport_topics,
} from "backend/drizzle/schema";
import { validateModuleForPublish } from "./publish-validation";
import { and, asc, eq, inArray } from "drizzle-orm";
import Elysia, { t } from "elysia";

const isCurriculumAdmin = (role: { code: string } | null, permissionsList?: string[]) =>
  role?.code === "admin";

export const passportController = new Elysia({ name: "@api/passport" })
  .use(ctx)
  .get("/passport/programs", async ({ drizzle }) => {
    const data = await drizzle.select().from(passport_programs)
      .orderBy(asc(passport_programs.position)).execute();
    return { total: data.length, data };
  }, { permission: "passport.matrix.view" });
```

Регистрация в `src/controllers.ts`: `import { passportController } from "./modules/passport/controller";` и `.use(passportController)` рядом с остальными.

- [ ] **Step 3: Смоук роутов локально**

Run: `cd /home/davr/managers/backend && NODE_ENV=development PORT=6799 CREDIT_SOCKET_PATH=/tmp/pass-dev-$$.sock timeout 8 bun run src/index.ts & sleep 4 && curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:6799/api/passport/programs`
Expected: 401 (роут есть, без сессии отлуп) — не 404.

- [ ] **Step 4: Достроить остальные эндпоинты**

Модули (с скоупом):

```ts
  .get("/passport/modules", async ({ drizzle, user, role, query, set }) => {
    const conds = [] as any[];
    if (query.program_id) {
      const links = await drizzle.select({ module_id: passport_program_modules.module_id })
        .from(passport_program_modules)
        .where(eq(passport_program_modules.program_id, query.program_id)).execute();
      conds.push(inArray(passport_modules.id, links.map((l) => l.module_id)));
    }
    if (!isCurriculumAdmin(role) && user?.department) {
      conds.push(eq(passport_modules.owner_department, user.department));
    }
    const data = await drizzle.select().from(passport_modules)
      .where(conds.length ? and(...conds) : undefined).execute();
    return { total: data.length, data };
  }, { permission: "passport.curriculum.edit", query: t.Object({ program_id: t.Optional(t.String()) }) })

  .post("/passport/modules", async ({ drizzle, user, body, set }) => {
    if (!user?.department && !isCurriculumAdmin(null)) { /* admin проверка через role в resolve */ }
    const dept = body.owner_department ?? user?.department;
    if (!dept) { set.status = 422; return { message: "owner_department required" }; }
    const [row] = await drizzle.insert(passport_modules).values({
      title_ru: body.title_ru, title_uz: body.title_uz ?? "",
      brand: body.brand ?? null, owner_department: dept,
    }).returning().execute();
    return row;
  }, {
    permission: "passport.curriculum.edit",
    body: t.Object({
      title_ru: t.String(), title_uz: t.Optional(t.String()),
      brand: t.Optional(t.Nullable(t.String())), owner_department: t.Optional(t.String()),
    }),
  })
```

Правило скоупа выносится в хелпер и применяется в PUT модуля/тем:

```ts
async function assertModuleEditable(drizzle: any, moduleId: string, user: any, role: any, set: any) {
  const [mod] = await drizzle.select().from(passport_modules)
    .where(eq(passport_modules.id, moduleId)).execute();
  if (!mod) { set.status = 404; return null; }
  if (mod.status === "published") { set.status = 409; return null; } // только new-version
  if (!isCurriculumAdmin(role) && mod.owner_department !== user?.department) {
    set.status = 403; return null;
  }
  return mod;
}
```

Publish:

```ts
  .post("/passport/modules/:id/publish", async ({ drizzle, params, set }) => {
    const [mod] = await drizzle.select().from(passport_modules)
      .where(eq(passport_modules.id, params.id)).execute();
    if (!mod) { set.status = 404; return { message: "not found" }; }
    const topics = await drizzle.select().from(passport_topics)
      .where(and(eq(passport_topics.module_id, params.id), eq(passport_topics.active, true)))
      .execute();
    const errors = validateModuleForPublish(mod, topics as any);
    if (errors.length) { set.status = 422; return { errors }; }
    const [updated] = await drizzle.update(passport_modules)
      .set({ status: "published", updated_at: new Date().toISOString() })
      .where(eq(passport_modules.id, params.id)).returning().execute();
    return updated;
  }, { permission: "passport.curriculum.publish", params: t.Object({ id: t.String() }) })
```

new-version (копия в draft):

```ts
  .post("/passport/modules/:id/new-version", async ({ drizzle, params, set }) => {
    const [mod] = await drizzle.select().from(passport_modules)
      .where(eq(passport_modules.id, params.id)).execute();
    if (!mod || mod.status !== "published") { set.status = 409; return { message: "only published" }; }
    const { id, created_at, updated_at, ...rest } = mod as any;
    const [copy] = await drizzle.insert(passport_modules)
      .values({ ...rest, status: "draft", version: mod.version + 1 }).returning().execute();
    const topics = await drizzle.select().from(passport_topics)
      .where(eq(passport_topics.module_id, params.id)).execute();
    for (const tp of topics) {
      const { id: _i, ...trest } = tp as any;
      await drizzle.insert(passport_topics).values({ ...trest, module_id: copy.id }).execute();
    }
    return copy;
  }, { permission: "passport.curriculum.edit", params: t.Object({ id: t.String() }) })
```

Темы CRUD и program-modules upsert — по тем же образцам (скоуп через `assertModuleEditable` по module_id темы).

- [ ] **Step 5: Ручной прогон CRUD**

Залогиниться админом (cookie), создать программу «Повар», модуль «Станция: тесто» (owner_department=kitchen_chopar, brand=chopar), 1 тему, привязать к программе, публикация с пустым uz → ожидать 422 с ошибками; заполнить uz → publish 200; PUT опубликованного → 409; new-version → draft v2.
Expected: все коды как в описании.

- [ ] **Step 6: Commit** — `git add backend/src/ backend/drizzle/ && git commit -m "feat(passport): curriculum CRUD with department scope and publish gate"`

---

### Task 6: Стажировки + инвайты

**Files:**
- Modify: `backend/src/modules/passport/controller.ts`

**Interfaces:**
- Consumes: `employees`, `passport_enrollments`, `passport_invites`.
- Produces:
  - `POST /passport/enrollments` (permission `passport.enrollments.manage`) body `{employee_id, program_id, probation_days}` → создаёт enrollment (terminal_id берётся из employees.terminal_id, probation_deadline = started_at + probation_days) + invite (expires 7 дней) → `{enrollment, invite_id}`; `invite_id` — это содержимое QR: `https://t.me/<PASSPORT_BOT>?startapp=inv_<invite_id>`.
  - `GET /passport/enrollments?terminal_id=&status=` (permission `passport.matrix.view`, terminal-scoped: не-HQ видит только свои терминалы из resolve).
  - `POST /passport/enrollments/:id/close` (manage) body `{result: "completed"|"failed"}`.
  - `POST /passport/enrollments/:id/reinvite` (manage) — новый invite, старые непогашенные экспайрятся.

- [ ] **Step 1: Эндпоинты**

```ts
  .post("/passport/enrollments", async ({ drizzle, user, body, set }) => {
    const [emp] = await drizzle.select().from(employees)
      .where(eq(employees.id, body.employee_id)).execute();
    if (!emp) { set.status = 404; return { message: "employee not found" }; }
    const startedAt = new Date();
    const probation = new Date(startedAt.getTime() + body.probation_days * 86400_000);
    const [enrollment] = await drizzle.insert(passport_enrollments).values({
      employee_id: emp.id, program_id: body.program_id, terminal_id: emp.terminal_id,
      probation_deadline: probation.toISOString(), created_by_user_id: user!.id,
    }).returning().execute();
    const [invite] = await drizzle.insert(passport_invites).values({
      enrollment_id: enrollment.id, created_by_user_id: user!.id,
      expires_at: new Date(startedAt.getTime() + 7 * 86400_000).toISOString(),
    }).returning().execute();
    return { enrollment, invite_id: invite.id };
  }, {
    permission: "passport.enrollments.manage",
    body: t.Object({ employee_id: t.String(), program_id: t.String(), probation_days: t.Number() }),
  })
```

`GET` — по конвенции list-эндпоинтов (limit/offset/filters) с автоскоупом `terminals` из resolve (образец — reports controller). `close`/`reinvite` — по 5-10 строк аналогично.

- [ ] **Step 2: Ручной прогон**

Создать enrollment для тестового сотрудника → 200 с invite_id; список отфильтрован по терминалу; close → status completed.

- [ ] **Step 3: Commit** — `git commit -m "feat(passport): enrollments and invites"`

---

### Task 7: TG-auth miniapp (initData HMAC → Redis-сессия)

**Files:**
- Create: `backend/src/modules/passport/tg-auth.ts`
- Test: `backend/src/modules/passport/tg-auth.test.ts`
- Create: `backend/src/modules/passport/tg-controller.ts`
- Modify: `backend/src/controllers.ts` (регистрация tg-контроллера)
- Modify: `backend/.env` (+`PASSPORT_BOT_TOKEN=...`)

**Interfaces:**
- Produces:
  - `verifyInitData(initData: string, botToken: string, nowSec: number): {ok: true; telegramId: number; firstName: string; startParam: string | null} | {ok: false; error: string}` — валидация по алгоритму Telegram Web Apps (secret = HMAC_SHA256(botToken, "WebAppData"), проверка hash и auth_date не старше 24ч).
  - `POST /passport/tg/auth` body `{init_data}`: верифицирует; если `startParam` = `inv_<uuid>` — гасит инвайт (`used_at`, проверка `expires_at`) и создаёт binding к employee; иначе ищет существующий binding (employee или user по `users.tg_id`-полю не лезем — mentor-binding создаёт HR через админку в Плане 1b, здесь только lookup). Возвращает `{token, expires_at, role: "trainee"|"mentor", lang}`; сессия в Redis `${PROJECT_PREFIX}passport_tg_session:<token>` = JSON `{binding_id, employee_id, user_id, telegram_id}`, TTL 12ч. 401 bad_init_data / 403 no_access|banned.
  - `passportTgCtx` — Elysia-плагин: derive из `Authorization: Bearer <token>` → `tgSession` или 401 (используется Task 8).

- [ ] **Step 1: Падающие тесты verifyInitData**

```ts
import { describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import { verifyInitData } from "./tg-auth";

const BOT = "123456:TEST_TOKEN";
function sign(params: Record<string, string>): string {
  const dataCheck = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(BOT).digest();
  const hash = createHmac("sha256", secret).update(dataCheck).digest("hex");
  return new URLSearchParams({ ...params, hash }).toString();
}

describe("verifyInitData", () => {
  const NOW = 1_800_000_000;
  const user = JSON.stringify({ id: 42, first_name: "Abror" });
  test("valid init data passes", () => {
    const init = sign({ auth_date: String(NOW - 60), user, start_param: "inv_x" });
    const res = verifyInitData(init, BOT, NOW);
    expect(res.ok).toBe(true);
    if (res.ok) { expect(res.telegramId).toBe(42); expect(res.startParam).toBe("inv_x"); }
  });
  test("tampered hash fails", () => {
    const init = sign({ auth_date: String(NOW - 60), user }) + "x";
    expect(verifyInitData(init, BOT, NOW).ok).toBe(false);
  });
  test("stale auth_date fails", () => {
    const init = sign({ auth_date: String(NOW - 90_000), user });
    expect(verifyInitData(init, BOT, NOW).ok).toBe(false);
  });
});
```

- [ ] **Step 2: FAIL прогон** — `bun test src/modules/passport/tg-auth.test.ts`.

- [ ] **Step 3: Реализация verifyInitData**

```ts
import { createHmac, timingSafeEqual } from "crypto";

export function verifyInitData(initData: string, botToken: string, nowSec: number) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false as const, error: "no_hash" };
  params.delete("hash");
  const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheck).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false as const, error: "bad_hash" };
  const authDate = Number(params.get("auth_date") ?? 0);
  if (!authDate || nowSec - authDate > 86_400) return { ok: false as const, error: "stale" };
  let telegramId = 0, firstName = "";
  try {
    const u = JSON.parse(params.get("user") ?? "{}");
    telegramId = Number(u.id ?? 0); firstName = String(u.first_name ?? "");
  } catch { return { ok: false as const, error: "bad_user" }; }
  if (!telegramId) return { ok: false as const, error: "no_user" };
  return { ok: true as const, telegramId, firstName, startParam: params.get("start_param") };
}
```

- [ ] **Step 4: PASS прогон**, затем tg-controller `POST /passport/tg/auth` + `passportTgCtx` (Redis get/set через `getRedisClient()`, токен `crypto.randomUUID()`), регистрация в controllers.ts.

- [ ] **Step 5: Смоук** — dev-boot, `curl -X POST .../api/passport/tg/auth -d '{"init_data":"garbage"}'` → 401 `bad_init_data`.

- [ ] **Step 6: Commit** — `git commit -m "feat(passport): telegram miniapp auth with invite redemption"`

---

### Task 8: Эндпоинты стажёра — /me, тема, материал, квиз (attestation source=miniapp)

**Files:**
- Modify: `backend/src/modules/passport/tg-controller.ts`

**Interfaces:**
- Consumes: `passportTgCtx` (Task 7), стейт-машина (Task 3), `gradeAttempt`/`pickQuestionIds`/`shuffleWithRng` из `@backend/modules/attestation/grading`.
- Produces (Bearer-auth стажёра):
  - `GET /passport/tg/me` → `{enrollment, program, modules: [{module, deadline_at, deadline_status: "ok"|"warning"|"overdue", topics: [{topic, level}]}], stamps}`. `deadline_at = started_at + deadline_days`; warning при ≤3 днях. Только published-модули программы.
  - `POST /passport/tg/topics/:id/opened` → журнал `material_opened` + уровень через `levelAfterMaterialOpened` (идемпотентно).
  - `POST /passport/tg/quiz/:topicId/start` → создаёт attempt в attestation-движке: `source: "miniapp"`, `launched_by_user_id: null`, вопросы через `pickQuestionIds`; анти-брут: Redis `passport_quiz_cd:<enrollment>:<topic>` — после 2 подряд провалов TTL 3600 → 429.
  - `POST /passport/tg/quiz/:topicId/submit` body `{attempt_id, answers}` → `gradeAttempt`; passed → журнал `quiz_passed` + `levelAfterQuizPassed`; фейл → журнал `quiz_failed` + счётчик кулдауна.

- [ ] **Step 1: Реализовать /me** (join enrollment→program_modules→modules(published)→topics + progress map). Дедлайн-статус — чистая функция рядом:

```ts
export function deadlineStatus(startedAtIso: string, deadlineDays: number | null, nowMs: number) {
  if (!deadlineDays) return { deadline_at: null, deadline_status: "ok" as const };
  const dl = new Date(startedAtIso).getTime() + deadlineDays * 86400_000;
  const st = nowMs > dl ? "overdue" : dl - nowMs <= 3 * 86400_000 ? "warning" : "ok";
  return { deadline_at: new Date(dl).toISOString(), deadline_status: st };
}
```

(+3 юнит-теста на границы в `tg-controller.test.ts` — ok/warning/overdue.)

- [ ] **Step 2: opened/quiz start/submit** — insert в `passport_signoffs` при каждом событии (action, actor_employee_id, terminal_id enrollment-а, ip из `request.headers.get("x-real-ip")`), upsert `passport_topic_progress` по уникальному ключу.

- [ ] **Step 3: Юнит + ручной смоук**

Run: `bun test src/modules/passport/` — все зелёные. Затем dev-boot: авторизация по реальному initData из тестового бота, `/me` → структура модулей. Идемпотентность `opened`: перед вставкой в журнал прочитать текущий level из progress; при level >= 1 НЕ писать новую строку material_opened и не менять level. Повторный вызов `opened` обязан оставить ровно одну строку material_opened в журнале.
Expected: quiz start → question_ids; submit с верными ответами → `{passed: true, level: 2}`.

- [ ] **Step 4: Commit** — `git commit -m "feat(passport): trainee endpoints - me, material, quiz via attestation engine"`

---

### Task 9: Простая подпись наставника (без QR — Этап 1)

**Files:**
- Modify: `backend/src/modules/passport/controller.ts`

**Interfaces:**
- Consumes: `canObserve`, `observationComplete`, `levelAfterObserved` (Task 3).
- Produces: `POST /passport/signoff` (cookie-auth, permission `passport.signoff`) body `{enrollment_id, topic_id, answers: {items: boolean[], questions: boolean[]}, declined?: boolean}`:
  - терминал enrollment-а обязан входить в `terminals` из resolve → иначе 403;
  - `canObserve(level, vt)` false → 409;
  - `declined: true` → журнал `observation_declined`, уровень не меняется;
  - `observationComplete` false → 422;
  - успех → журнал `observed` + progress: level=`levelAfterObserved`, observed_by, observation_answers.

- [ ] **Step 1: Реализация** (по образцам Task 5/8, ~40 строк).

- [ ] **Step 2: Ручной прогон**: подпись стажёра чужого терминала → 403; уровень 1 при quiz_observation → 409; неполные отметки → 422; полные → level 3, строка в журнале.

- [ ] **Step 3: Commit** — `git commit -m "feat(passport): mentor signoff endpoint (stage 1, no QR yet)"`

---

### Task 10: Деплой в прод по DEPLOY.md + фиксация плана

**Files:**
- Modify: `/home/davr/managers/backend/app` (бинарь, вне git)

- [ ] **Step 1: Полный прогон тестов** — `cd /home/davr/managers/backend && bun test src/modules/passport/` → всё зелёное.

- [ ] **Step 2: Деплой строго по DEPLOY.md**

```bash
cd /home/davr/managers/backend
cp app app.bak_$(date +%s)
/root/.bun/bin/bun build --compile src/index.ts --outfile app.new
NODE_ENV=development PORT=6798 CREDIT_SOCKET_PATH=/tmp/credit-smoke-$$.sock ./app.new &
SMOKE_PID=$!; sleep 3
curl -sS -m 5 http://127.0.0.1:6798/ -o /dev/null -w 'http: %{http_code}\n'
curl -sS -m 5 http://127.0.0.1:6798/api/passport/programs -o /dev/null -w 'passport: %{http_code}\n'
kill $SMOKE_PID; wait $SMOKE_PID 2>/dev/null
mv app.new app
pm2 restart office_api
```

Expected: passport-роут отвечает 401 (не 404) на смоуке и на проде (`curl https://api.office.lesailes.uz/api/passport/programs` → 401).

- [ ] **Step 3: Роли** — через office-админку (или SQL) раздать passport-права ролям: HR-роль (publish, enrollments.manage, matrix.view), менеджерская роль (signoff, matrix.view свои), будущие департамент-редакторы (curriculum.edit) + проставить `users.department` реальным людям HR-списка из «варакаси».

- [ ] **Step 4: Commit + push** — `git add -A && git commit -m "feat(passport): stage 1a backend core complete" && git push` (если PAT жив; иначе только локальный коммит, отметить в выводе).

---

## Вне плана 1a (следующие планы)

- **1b (office_admin):** страницы /passport/curriculum (двуязычный конструктор), /passport/enrollments (инвайт-QR печать), mentor-binding для менеджеров, медиа-аплоад + X-Accel + транскод.
- **1c (miniapp):** форк les_training_miniapp → passport-app, экраны стажёра/наставника, бот-регистрация (BotFather) и пуши. UI-процесс: dribbble-референсы через chrome-attach + aesthetic/design-taste скиллы (требование заказчика).
- Этап 2+: QR-рукопожатие (таблица уже есть), киоск-экзамены модулей, штампы универсалов, ре-проверки, детектор, матрица, деньги.

## Self-review

- Spec coverage (в скоупе 1a): схема §4 ✓ (T1), права §5 ✓ (T2), стейт-машина §8 ✓ (T3), публикация/языки §7.1 ✓ (T4-5), департамент-скоуп §5.1 ✓ (T5), enrollments/инвайты §7.4 ✓ (T6), TG-auth §5.2 ✓ (T7), стажёрские эндпоинты+квиз-гибрид §5.2/§2.7 ✓ (T8), подпись §5.3 (упрощённая, QR в Этапе 2 — соответствует этапности §12) ✓ (T9), бэкапы §11 ✓ (T0), деплой-грабли ✓ (T10).
- Placeholder scan: чисто; в T5 Step 4 фрагмент `where`-заглушки удалён при реализации (conds-паттерн показан полностью).
- Type consistency: `verification_type` строки совпадают со схемой/enum; `invite_id` = uuid PK passport_invites везде; session-ключ `passport_tg_session` в T7/T8.
