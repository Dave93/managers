import { pgEnum } from 'drizzle-orm/pg-core';

export const reportStatusEnum = pgEnum('report_status', ['sent', 'checking', 'comfirmed', 'cancelled']);