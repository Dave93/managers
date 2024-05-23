import { pgTable, text, integer, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { reportItemTypeEnum } from './report-item-type-enum';

export const reportsItems = pgTable('reports_items', { id: text('id').default(sql`gen_random_uuid()`).notNull(), report_id: text('report_id').notNull(), label: text('label').notNull(), type: reportItemTypeEnum('type').notNull(), amount: integer('amount').default(0).notNull(), source: text('source').notNull(), group_id: text('group_id'), report_date: timestamp('report_date', { mode: 'date', precision: 3 }).notNull(), created_at: timestamp('created_at', { mode: 'date', precision: 3 }).defaultNow().notNull(), updated_at: timestamp('updated_at', { mode: 'date', precision: 3 }).defaultNow().notNull() });