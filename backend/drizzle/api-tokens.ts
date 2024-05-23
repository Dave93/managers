import { pgTable, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const apiTokens = pgTable('api_tokens', { id: text('id').default(sql`gen_random_uuid()`).primaryKey(), active: boolean('active').default(false).notNull(), token: text('token').notNull(), organization_id: text('organization_id').notNull(), created_at: timestamp('created_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), updated_at: timestamp('updated_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), created_by: text('created_by'), updated_by: text('updated_by') });