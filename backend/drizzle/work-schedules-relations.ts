import { relations } from 'drizzle-orm';
import { workSchedules } from './work-schedules';
import { usersWorkSchedules } from './users-work-schedules';
import { workScheduleEntries } from './work-schedule-entries';
import { users } from './users';
import { organizations } from './organizations';

export const workSchedulesRelations = relations(workSchedules, (helpers) => ({ users_work_schedules: helpers.many(usersWorkSchedules, { relationName: 'Users_work_schedulesToWork_schedules' }), work_schedule_entries_work_schedules: helpers.many(workScheduleEntries, { relationName: 'work_schedule_entries_work_schedules' }), work_schedules_created_byTousers: helpers.one(users, { relationName: 'work_schedules_created_byTousers', fields: [ workSchedules.created_by ], references: [ users.id ] }), organization: helpers.one(organizations, { relationName: 'work_schedules_organization_idTorganization', fields: [ workSchedules.organization_id ], references: [ organizations.id ] }), work_schedules_updated_byTousers: helpers.one(users, { relationName: 'work_schedules_updated_byTousers', fields: [ workSchedules.updated_by ], references: [ users.id ] }) }));