import { pgEnum } from 'drizzle-orm/pg-core';

export const workScheduleEntryStatusEnum = pgEnum('work_schedule_entry_status', ['open', 'closed']);