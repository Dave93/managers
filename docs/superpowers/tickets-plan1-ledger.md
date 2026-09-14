# SDD ledger — plan: docs/superpowers/plans/2026-09-12-tickets-1-backend-core.md

Spec: docs/superpowers/specs/2026-09-12-tickets-design.md
Branch: feature/tickets (from main 4d6ee21), 2026-09-14
Execution: субагенты работают по ssh root@choparpizza.uz, репо /home/davr/managers

## Pre-flight scan

| Пара | Что производит / потребляет | Итог |
|---|---|---|
| T1 → T6,T7,T8,T9,T10 | таблицы и enum-ы схемы → импорты контроллера и сидов | имена совпадают: tickets, ticket_types, ticket_executors, ticket_contractors, ticket_attachments, ticket_comments, ticket_work_items, ticket_events; terminals.organization_id существует |
| T2 → (никто в плане 1) | nextStatus/allowedActions | КОНФЛИКТ: T7 пишет статусы литералами, модуль остаётся мёртвым кодом → R1 |
| T3 → T6, T9 | validateDetails, validateSchema, FieldDef | сигнатуры совпадают; T9 добавляет импорт validateSchema |
| T4 → (никто в плане 1) | normalizeWorkItems | интерфейс для Плана 3 (сдача работы исполнителем), вызывающего кода в плане 1 нет → R3 |
| T5 → T6 | saveAttachment, checkUpload, MAX_FILES_PER_PHASE | совпадают |
| T6 → T7,T8,T9 | один файл controller.ts, цепочка Elysia | последовательные правки одного файла, параллелить нельзя |
| T6 → T11 | роуты /api/tickets*, /api/ticket_* | smoke-проверки T11 соответствуют объявленным роутам |
| T2,T3,T4,T5 → T11 | тесты | 6+14+8+7 = 35, совпадает с ожиданием T11 |
| T8 vs T6/T7 | /tickets/payment/approve vs /tickets/:id/close | не конфликтуют: второй сегмент различается |

Самосогласованность задач: T1 (схема vs индексы) — ок; T2 (тесты vs таблица переходов) — ок; T3 (тесты vs правила) — ок; T4 (тесты vs тийины) — ок; T5 (тесты vs лимиты) — ок; T6 (создание vs события vs очистка сирот) — ок; T7 — ДЕФЕКТ, см. R2; T8 (идемпотентность через WHERE payment_status=pending) — ок; T9 (валидация схемы при сохранении) — ок; T10 (сиды идемпотентны, description<60) — ок; T11 (ожидания vs реальные роуты) — ок.

Ruling R1: T2 дополнительно экспортирует allowedFrom(action): TicketStatus[], T7 строит WHERE через него (inArray(tickets.status, allowedFrom("accept"))) вместо литералов — жизненный цикл остаётся в одном месте, иначе модуль состояний мёртв, а правила задвоены. Цена ошибки: лишняя функция в state.ts, откатывается одной правкой.
Ruling R2: T7 в close/reopen/cancel кладёт terminal-скоуп ВНУТРЬ WHERE у UPDATE, а не проверяет userTerminals после. В плане close сначала закрывает заявку чужого филиала и только потом отдаёт 404 — фактическая запись по чужому филиалу. Цена ошибки: нет, это строго безопаснее.
Ruling R3: act.ts (T4) и state.ts (T2) в плане 1 не имеют вызывающего кода для сдачи работы — это интерфейсы для Плана 3 (API исполнителя). Ревьюерам даётся как контекст, не как запрет на находку. Цена ошибки: если План 3 не состоится, два модуля остаются неиспользованными.

Task 1: implemented (commit 0beb53d), review = Needs fixes (2 Important plan-mandated, 2 Minor)
Ruling R4: находка «нет CHECK на ровно одно из contractor_id/user_id» — чиню. Спека (§4 ticket_executors) требует check-констрейнт прямым текстом, план его потерял при переносе в код; спека — связывающий авторитет. Цена ошибки: нет, констрейнт на пустой таблице.
Ruling R5: находка «FK на actor_executor_id / author_executor_id / uploaded_by_executor_id отсутствуют» — чиню. Те же ссылки на ticket_executors уже под FK в tickets и ticket_notifications; половинчатая целостность в журнале событий хуже, чем никакой. Цена ошибки: удаление исполнителя потребует чистки журнала — но удаление и не предусмотрено (is_active).
Ruling R6: Minor «нет индекса под вкладку К оплате» поднимаю до фикса. Спека §4 называет частичный индекс по (payment_status) where status=closed явно, план его потерял. Цена ошибки: лишний индекс на 40 байт строки.
Ruling R7: Minor про арифметику в отчёте импелементера (9 FK vs 10, 14 индексов vs 15) — не дефект кода, правки не требует; зафиксировано и закрыто.
Task 1: fix round 1/5 (3 addressed: CHECK ticket_executors_kind_target, 3 FK на ticket_executors, частичный idx_tickets_payment_pending; commits 0beb53d..f921b80). Миграция 0025 применена (drizzle.__drizzle_migrations id 17), SQL вычитан контроллером: только ADD CONSTRAINT + CREATE INDEX по ticket_*, разрушительных операций нет.
Note: у импелементера первая попытка drizzle-kit migrate была отклонена классификатором auto-mode, повтор прошёл; результат проверен контроллером независимо по содержимому 0025 и состоянию БД.
Task 1: complete (commits 4d6ee21..f921b80, re-review clean — 3/3 addressed, новых поломок нет)
Task 2: complete (commits f921b80..97fb582, review clean, 9 тестов вместо 6 — добавлены 3 на allowedFrom по R1)
Note: ожидание T11 «35 pass» надо пересчитать — T2 даёт 9 вместо 6, итог сдвигается на +3.
Task 3: implemented (commit 586b8e2, 14 тестов), review = Needs fixes (1 Important plan-mandated + 3 Minor)
Ruling R8: находка «значение неверного типа для известного поля трактуется как отсутствующее» — чиню. Спека: details приходят из HTTP как недоверенный ввод и уезжают в jsonb; тихо отброшенное значение необязательного поля — потеря данных без следа. Цена ошибки: нет, ужесточение валидации на пустых данных.
Ruling R9: Minor «typeof [] === object, массив в схеме даёт неточное сообщение» и Minor «правила без тестов» беру в тот же раунд — дёшево и закрывает пробел «правило реализовано, но не проверено». KEY_RE {0,30} оставляю как есть (граница произвольная, но безвредная), тест на границу не требую.
Task 3: fix round 1/5 (3 addressed, 0 open; commits 586b8e2..79de846), re-review: новых поломок нет
Task 3: complete (commits 97fb582..79de846, review clean, 25 тестов)
Task 4: implemented (commit 62b1d46, 8 тестов), review = Needs fixes (6 Important, 3 Minor)
Ruling R10: qty:null и unit любой не-строковой формы обязаны давать ошибку с номером позиции, а не тихо становиться 1.00 / null. Это прямое требование закалки, выданной вместе с задачей; тихая подмена в акте = спор о деньгах с подрядчиком без следов в данных. Цена ошибки: нет.
Ruling R11: unit.slice(0,20) заменить на ошибку при длине >20. Колонка varchar(20); молчаливая обрезка единицы измерения меняет смысл строки акта.
Ruling R12: добавить проверку Number.isSafeInteger на НАКОПЛЕННУЮ сумму и явный потолок под numeric(14,2) — 99_999_999_999_999 тийинов (999_999_999_999.99). Иначе 50 больших позиций дают неточный итог молча, а слишком большая сумма падает уже на INSERT в будущем Плане 3. Цена ошибки: заявка с суммой больше триллиона сумов будет отвергнута — приемлемо.
Ruling R13: Minor про position беру (явный i+1 вместо items.length+1) и Minor про пробелы в тестах (граница 50 позиций, qty не по умолчанию, накопление нескольких ошибок) — дёшево.
Task 4: fix round 1/5 (7 addressed, 0 open; commits 62b1d46..7c64ae8), re-review: новых поломок нет
Task 4: complete (commits 79de846..7c64ae8, review clean, 19 тестов)
Note (для финального ревью): ре-ревью T4 отметил, что часть новых тестов на кривые формы amount/title/qty проходила и до фикса — регрессионное покрытие шире, чем реально исправленная поверхность. Не дефект, но знать полезно.
Task 5: implemented (commit f2a1724, 20 тестов), review = Needs fixes (3 Important, 3 Minor)
Ruling R14: «/invalid/<hash>/» namespace в attachmentPath убрать. Спека фиксирует ровно одну раскладку uploads/tickets/<ticket_id>/<uuid>.<ext>; функция построения безопасного пути обязана падать на мусорном id, а не возвращать правдоподобную строку в каталог, который никто не читает и не чистит. Плюс ветка падает с TypeError на null/undefined. Цена ошибки: вызывающий обязан ловить исключение — у нас он единственный (saveAttachment) и id уже валидирует.
Ruling R15: требую тесты на saveAttachment через временный каталог (TICKETS_UPLOADS_DIR на mkdtemp, уборка после) — функция на записи, а покрытия у неё ноль. Прод-каталог в тестах не трогать.
Ruling R16: отдельное сообщение для нефинитного size — сейчас NaN отдаёт «файл больше 10 МБ», что уедет в 422 к клиенту как ложь.
Ruling R17: после mkdirSync явный chmod каталога заявки — при recursive:true режим достаётся только самому глубокому созданному каталогу.
Task 5: fix round 1/5 (4 addressed, 0 open; commits f2a1724..aaadb11), re-review: новых поломок нет
Task 5: complete (commits 7c64ae8..aaadb11, review clean, 26 тестов)
Note: /home/davr/managers/uploads/tickets на сервере ещё не существует — создастся при первой загрузке с chmod 0o750. Для Плана 6 (деплой): проверить владельца/setgid по образцу uploads/credit.
Интерфейсы для T6: attachmentPath БРОСАЕТ на не-UUID (не возвращает путь), saveAttachment ловит и отдаёт {ok:false}; checkUpload отвергает не-строковый mime и нефинитные size/existingCount.
Task 6: implemented (commit 97d6f5d, 4 роута + регистрация), review = Needs fixes (2 Important plan-mandated, 4 Minor)
Ruling R18: «return внутри try при сбое saveAttachment на N-м файле не запускает cleanup» — чиню. Файлы 1..N-1 остаются сиротами на диске, а спека прямо требует, чтобы неудача не оставляла мусор. Дефект в коде моего плана. Цена ошибки: нет.
Ruling R19: «неизвестный priority тихо становится normal» — чиню. Четвёртый случай того же класса за план (T3 details, T4 qty/unit, T5 size): опечатка оператора превращает срочную заявку в обычную молча. Валидировать по списку, 422 на чужое значение.
Ruling R20: Minor беру в тот же раунд: (а) limit/offset через unary + дают NaN и сырую ошибку БД вместо 422; (б) не-UUID в params даёт 500 от Postgres вместо 404; (в) catch{} вокруг unlink без лога скрывает системную проблему с диском. Все три — дешёвые правки на том же файле.
Ruling R21: terminal_id из body оставляю как есть — проверка includes() закрывает межфилиальное создание, переписывать ради буквы формулировки не стоит. Цена ошибки: если проверку однажды удалят, тело запроса снова станет источником филиала; помечено для финального ревью.
Task 6: fix round 1/5 (5 addressed, 0 open; commits 97d6f5d..0d1a1dc), re-review: новых поломок нет; smoke теперь доказывает и гейт прав на POST (401 на корректном multipart без куки)
Task 6: complete (commits aaadb11..0d1a1dc, review clean)
Task 7: implemented (commit a200d92, 5 роутов; R1 и R2 применены корректно), review = Approved с 1 Important (дублирование) + 4 Minor
Ruling R22: Important «трижды дословно повторён блок 404-vs-409 и сборка WHERE» беру в фикс. Ровно тот риск дрейфа, ради которого вводился R1: правка скоупинга в двух из трёх мест и забытая третья. Цена ошибки: ещё один хелпер в файле.
Ruling R23: добавляю в state.ts targetStatus(action) и использую его в .set() вместо литералов "closed"/"in_progress"/"cancelled" — вторая половина того же R1; целевой статус сейчас живёт отдельно от таблицы переходов.
Ruling R24: Minor про cancel payload (пустая строка вместо null) беру. Minor про TOCTOU диагностического чтения и про scope-check-then-act в comments НЕ чиню: первый даёт максимум устаревший код ошибки, второй не открывает обхода (нет статусного гейта). Цена ошибки: при гонке комментарий может лечь в заявку, только что уехавшую в другой филиал — перенос филиала в этой системе не предусмотрен.
Task 7: fix round 1/5 (3 addressed, 0 open; commits a200d92..c22e796), re-review: новых поломок нет, @backend/lib/db импортирован только как тип
Task 7: complete (commits 0d1a1dc..c22e796, review clean, state.test 10 тестов)
Task 8: implemented (commit b531091, 2 роута), review = Needs fixes (1 Important дублирование + 3 Minor)
Ruling R25: Important «оба платёжных роута дословно повторяют сборку WHERE и форму транзакции» — чиню, тем же приёмом, что в T7. Расхождение копий на денежном пути дороже лишнего хелпера.
Ruling R26: Minor «дубликаты в ids перекашивают skipped» беру — дедуплицировать ids перед UPDATE. Финансист читает эти числа как отчёт о своей пачке.
Ruling R27: Minor «skipped не различает причины» и «200 последовательных writeEvent в транзакции» НЕ чиню. Первое — вопрос будущего UI офиса (План 5), второе безопасно: откат целиком, а пачки такого размера бывают раз в неделю. Цена ошибки: длинная транзакция держит блокировки на закрытых заявках, которые никто параллельно не трогает.
Task 8: fix round 1/5 (2 addressed, 0 open; commits b531091..308e3fc), re-review: новых поломок нет, tsc до/после идентичен
Task 8: complete (commits c22e796..308e3fc, review clean)
Task 8: minor (deferred): tsc показывает предсуществующие ошибки вне модуля (app.ts/controllers.ts instantiation depth, pagination_interface.ts) плюс Dirent-ошибки в нашем storage.test.ts — последнее стоит глянуть на финальном ревью.
Task 9: implemented (commit e23f414, справочники), review = Needs fixes (2 Important + 3 Minor)
Ruling R28: Important «PUT /ticket_types может выставить contractor_id типу с kind=staff» — чиню. Инвариант, который держится на создании и разваливается на правке, не инвариант; заявка такого типа уйдёт в никуда.
Ruling R29: Important «скелет UUID-гард → сборка patch → 404 повторён трижды» — чиню, тем же приёмом, что в T7 и T8.
Ruling R30: Minor беру все три: UUID-гард на FK-поля тела (иначе сырая ошибка Postgres вместо 422), проверка имени констрейнта в обработчике 23505, уборка лишнего full_name из .returning(). Все дешёвые.
Task 9: fix round 1/5 (5 addressed, 0 open; commits e23f414..dfd88dd), re-review: новых поломок нет, tsc до/после идентичен (26 предсуществующих ошибок вне модуля)
Task 9: complete (commits 308e3fc..dfd88dd, review clean)
Task 9: minor (deferred): POST /ticket_types проверяет только «external требует contractor_id», зеркала «staff не должен иметь contractor_id» нет — в PUT оно есть (R28), в ticket_executors тоже. Триаж на финальном ревью.
Task 10: implemented (commit ce4ae73), review = Approved (1 «Important», 1 Minor)
Ruling R31: находку «сиды не обёрнуты в транзакцию» понижаю до отложенного minor и НЕ чиню. Ревьюер сам назвал её приемлемой («acceptable», «not a blocker») — по калибровке это Minor, а не Important. Оба скрипта идемпотентны: частичный сбой добивается повторным прогоном, что и есть их штатный режим восстановления. Цена ошибки: при падении посреди цикла в БД остаются вставленные строки — безвредно, повторный прогон дополняет.
Контроллер независимо проверил прод: 8 прав tickets.*, ticket_types = ad_tv|3 поля|external|contractor_id пуст, cameras|3|external|пуст.
Task 10: complete (commits dfd88dd..ce4ae73, review clean, 1 minor deferred)
Task 11: complete (commit 9c7b48d — журнал docs/superpowers/tickets-progress.md). Проверено: 80/80 тестов модуля (4 файла), 127/127 соседних (passport 32, credit 95), 21/21 роут отвечает 401/422 без 404 и 500, файлы ветки только свои (контроллер сверил независимо), 19 коммитов.
Task 11: minor (deferred): tsc даёт 2 ошибки внутри модуля — Dirent.path в storage.test.ts; 14 предсуществующих вне модуля.

## Финальное ревью ветки (4d6ee21..9c7b48d, opus): Critical нет, 3 пункта «до мержа» + 4 Important + Minor
Ruling R32: инвариант «external обязан иметь contractor_id» СМЯГЧАЮ, а не ужесточаю. Тип заводится раньше, чем подписан договор с фирмой; сид уже создал два таких типа на проде, и PUT сейчас не даёт даже переименовать их. Решение: external без фирмы — легальное «не привязано», но заявку по такому типу создать нельзя (422 на POST /tickets). Зеркало «staff не должен иметь contractor_id» добавляю в POST и PUT. Спеку правлю под это решение. Цена ошибки: тип можно опубликовать неработающим — видно по пустой фирме в админке.
Ruling R33: UUID-гарды на type_id и terminal_id в POST /tickets — чиню. Тот же класс, что ловили 11 раундов, пропущен на самом горячем роуте: устаревший кэш планшета даёт 500 вместо 422.
Ruling R34: tsc Dirent.path в storage.test.ts — чиню, одна строка.
Ruling R35: requires_cost/очередь оплаты — утверждение суммы требует непустой work_total_amount. Иначе заявка без акта попадает в «К оплате» с пустой суммой и утверждается в никуда. Решаю сейчас, потому что писатель work_total_amount появится в Плане 3 и построит на этом.
Ruling R36: Important «нет route-level тестов на авторизацию» — НЕ делаю в этом плане. HTTP-харнесса с сессией в репозитории нет ни у одного модуля; это отдельная задача, а не довесок. Переношу в План 2 как первую задачу. Цена ошибки: скоупинг проверен чтением (все 21 роут), но без регрессионной сетки — следующий план добавит вторую модель доступа (исполнитель по фирме) на те же таблицы.
Ruling R37: из Minor беру: частичный файл при падении Bun.write, неудалённый пустой каталог заявки, битая ссылка-инвайт при пустом TICKETS_BOT_USERNAME, неактивные типы в списке для планшета, дублирование UUID_RE. Остальные Minor фиксирую как отложенные (sort/fields не используются, seen и comments под tickets.list, payment_approved_by при отклонении, карточка отдаёт payment_comment филиалу, user_id без FK, writeEvent tx:any, existingCount в create, mime с клиента).
Ruling R38: разбиение controller.ts (1071 строка) на shared/routes-* — НЕ делаю сейчас. Ревью право, что перед /tickets/tg/* это нужно, но резать файл в последнем раунде и заново гонять все проверки дороже, чем начать с этого План 3. Записано как первая задача того плана.
Final fix wave: commits 9c7b48d..8f00a62 (bf38769 код, 51e9a92 спека, 8f00a62 регрессия уборки temp в тесте). Ре-ревью: все 8 пунктов закрыты; найдена и починена регрессия Dirent.parentPath.
Контроллер проверил независимо: 81 тест проходит, /tmp/tickets-* не остаются после прогона (0 до, 0 после).
PLAN 1 COMPLETE: 4d6ee21..8f00a62, 22 коммита.
