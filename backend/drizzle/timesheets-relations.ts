import { relations } from 'drizzle-orm';
import { timesheets } from './timesheets';
import { users } from './users';

export const timesheetsRelations = relations(timesheets, (helpers) => ({ timesheet_users: helpers.one(users, { relationName: 'TimesheetToUsers', fields: [ timesheets.user_id ], references: [ users.id ] }) }));