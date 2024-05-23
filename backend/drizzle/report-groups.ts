import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const reportGroups = pgTable('report_groups', { id: text('id').default(sql`gen_random_uuid()`).primaryKey(), name: text('name').notNull(), code: text('code').notNull(), created_at: timestamp('created_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), updated_at: timestamp('updated_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), parent_id: text('parent_id') });