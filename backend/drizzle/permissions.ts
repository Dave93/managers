import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const permissions = pgTable('permissions', { id: text('id').default(sql`gen_random_uuid()`).primaryKey(), slug: text('slug').notNull(), description: text('description').notNull(), active: boolean('active').default(true).notNull(), created_at: timestamp('created_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), updated_at: timestamp('updated_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), created_by: text('created_by'), updated_by: text('updated_by') });