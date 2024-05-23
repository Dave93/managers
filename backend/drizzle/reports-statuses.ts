import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const reportsStatuses = pgTable('reports_status', { id: text('id').default(sql`gen_random_uuid()`).primaryKey(), code: text('code').notNull(), color: text('color').notNull(), created_at: timestamp('created_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), updated_at: timestamp('updated_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), label: text('label').notNull() });