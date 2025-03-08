-- Добавляем поле is_first_job в таблицу candidates
ALTER TABLE candidates ADD COLUMN is_first_job BOOLEAN DEFAULT FALSE; 