import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const timesheets = pgTable('timesheet', { id: text('id').default(sql`gen_random_uuid()`).primaryKey(), user_id: text('user_id').notNull(), is_late: boolean('is_late').default(false).notNull(), date: timestamp('date', { mode: 'date', precision: 3 }).notNull(), created_at: timestamp('created_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), updated_at: timestamp('updated_at', { mode: 'date', precision: 3 }).defaultNow().notNull() });