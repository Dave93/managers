import { work_schedules, work_schedule_entries } from "backend/drizzle/schema";

export type WorkScheduleEntry = {
  id?: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_day_off?: boolean;
  minutes_late_threshold?: number;
};

    export type WorkSchedule = typeof work_schedules.$inferSelect & {
  entries: (typeof work_schedule_entries.$inferSelect)[];
};