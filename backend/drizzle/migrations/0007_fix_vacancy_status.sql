-- Создаем временную колонку с новым типом
ALTER TABLE vacancy ADD COLUMN status_new vacancy_status_v2;

-- Копируем данные, приводя их к новому типу
UPDATE vacancy SET status_new = status::text::vacancy_status_v2;

-- Удаляем старую колонку
ALTER TABLE vacancy DROP COLUMN status;

-- Переименовываем новую колонку
ALTER TABLE vacancy RENAME COLUMN status_new TO status;

-- Добавляем NOT NULL если это требуется (опционально)
ALTER TABLE vacancy ALTER COLUMN status SET NOT NULL;