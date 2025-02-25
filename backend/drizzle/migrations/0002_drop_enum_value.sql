-- Создаем новый тип enum без значения "candidates_found"
DO $$ BEGIN
    CREATE TYPE vacancy_status_new AS ENUM (
        'open',
        'in_progress',
        'interview',
        'closed',
        'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Обновляем значения в таблице vacancy (если есть записи с "candidates_found", меняем их на "in_progress")
UPDATE vacancy 
SET status = 'in_progress'::vacancy_status_new 
WHERE status = 'candidates_found'::vacancy_status;

-- Изменяем тип столбца на новый enum
ALTER TABLE vacancy 
ALTER COLUMN status TYPE vacancy_status_new 
USING status::text::vacancy_status_new;

-- Удаляем старый тип
DROP TYPE vacancy_status;

-- Переименовываем новый тип в старое имя
ALTER TYPE vacancy_status_new RENAME TO vacancy_status; 