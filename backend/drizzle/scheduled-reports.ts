import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const scheduledReports = pgTable('scheduled_reports', { id: text('id').default(sql`gen_random_uuid()`).primaryKey(), name: text('name').notNull(), code: text('code').notNull(), cron: text('cron').notNull(), created_at: timestamp('created_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), updated_at: timestamp('updated_at', { mode: 'date', precision: 3 }).defaultNow().notNull() });