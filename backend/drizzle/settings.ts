import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const settings = pgTable('settings', { id: text('id').default(sql`gen_random_uuid()`).primaryKey(), key: text('key').notNull(), value: text('value').notNull(), is_secure: boolean('is_secure').default(false).notNull(), created_at: timestamp('created_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), updated_at: timestamp('updated_at', { mode: 'date', precision: 3 }).defaultNow().notNull() });