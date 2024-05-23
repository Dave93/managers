import { pgTable, text, boolean, doublePrecision, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const terminals = pgTable('terminals', { id: text('id').default(sql`gen_random_uuid()`).primaryKey(), name: text('name').notNull(), active: boolean('active').default(true).notNull(), phone: text('phone'), address: text('address'), latitude: doublePrecision('latitude').default(0).notNull(), longitude: doublePrecision('longitude').default(0).notNull(), organization_id: text('organization_id').notNull(), manager_name: text('manager_name'), created_at: timestamp('created_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), updated_at: timestamp('updated_at', { mode: 'date', precision: 3 }).defaultNow().notNull() });