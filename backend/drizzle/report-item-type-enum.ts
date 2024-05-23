import { pgEnum } from 'drizzle-orm/pg-core';

export const reportItemTypeEnum = pgEnum('report_item_type', ['income', 'outcome']);