import { pgTable, text } from 'drizzle-orm/pg-core';

export const usersWorkSchedules = pgTable('users_work_schedules', { user_id: text('user_id').notNull(), work_schedule_id: text('work_schedule_id').notNull() });