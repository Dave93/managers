-- Проверяем существование типа
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vacancy_status_v2') THEN
        CREATE TYPE vacancy_status_v2 AS ENUM (
            'open',
            'in_progress',
            'found_candidates',
            'interview',
            'closed',
            'cancelled'
        );
    END IF;
END
$$; 