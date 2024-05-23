import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const scheduledReportsSubscriptions = pgTable('scheduled_reports_subscription', { id: text('id').default(sql`gen_random_uuid()`).primaryKey(), report_id: text('report_id').notNull(), user_id: text('user_id').notNull(), created_at: timestamp('created_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), updated_at: timestamp('updated_at', { mode: 'date', precision: 3 }).defaultNow().notNull() });