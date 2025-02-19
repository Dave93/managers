-- Показать все enum типы
SELECT typname, typtype
FROM pg_type 
WHERE typtype = 'e';

-- Для конкретного enum можно посмотреть все значения так:
SELECT enum_range(NULL::vacancy_status);

-- Или для всех enum сразу:
SELECT 
    t.typname,
    array_agg(e.enumlabel ORDER BY e.enumsortorder) as enum_values
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
GROUP BY t.typname; 