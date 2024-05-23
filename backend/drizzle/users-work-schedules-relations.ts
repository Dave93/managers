import { relations } from 'drizzle-orm';
import { usersWorkSchedules } from './users-work-schedules';
import { users } from './users';
import { workSchedules } from './work-schedules';

export const usersWorkSchedulesRelations = relations(usersWorkSchedules, (helpers) => ({ users: helpers.one(users, { relationName: 'UsersToUsers_work_schedules', fields: [ usersWorkSchedules.user_id ], references: [ users.id ] }), work_schedules: helpers.one(workSchedules, { relationName: 'Users_work_schedulesToWork_schedules', fields: [ usersWorkSchedules.work_schedule_id ], references: [ workSchedules.id ] }) }));