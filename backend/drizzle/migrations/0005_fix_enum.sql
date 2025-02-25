-- Создаем новый тип enum
DO $$ BEGIN
    CREATE TYPE vacancy_status_v2_new AS ENUM (
        'open',
        'in_progress',
        'interview',
        'closed',
        'cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Создаем временную колонку с новым типом
ALTER TABLE vacancy 
ADD COLUMN status_new vacancy_status_v2_new;

-- Копируем данные в новую колонку, преобразуя значения
UPDATE vacancy 
SET status_new = CASE 
    WHEN status::text = 'found_candidates' THEN 'in_progress'::vacancy_status_v2_new
    ELSE status::text::vacancy_status_v2_new
END;

-- Удаляем старую колонку
ALTER TABLE vacancy 
DROP COLUMN status;

-- Переименовываем новую колонку
ALTER TABLE vacancy 
RENAME COLUMN status_new TO status;

-- Удаляем старый тип
DROP TYPE IF EXISTS vacancy_status_v2;

-- Переименовываем новый тип
ALTER TYPE vacancy_status_v2_new RENAME TO vacancy_status_v2; 