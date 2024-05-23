import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const credentials = pgTable('credentials', { id: text('id').default(sql`gen_random_uuid()`).primaryKey(), key: text('key').notNull(), model: text('model').notNull(), type: text('type').notNull(), created_at: timestamp('created_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), updated_at: timestamp('updated_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), created_by: text('created_by'), updated_by: text('updated_by'), model_id: text('model_id').notNull() });