import { relations } from 'drizzle-orm';
import { reports } from './reports';
import { reportsStatuses } from './reports-statuses';
import { terminals } from './terminals';
import { users } from './users';
import { reportsItems } from './reports-items';
import { reportsLogs } from './reports-logs';

export const reportsRelations = relations(reports, (helpers) => ({ reports_status_id: helpers.one(reportsStatuses, { relationName: 'reports_status_id', fields: [ reports.status_id ], references: [ reportsStatuses.id ] }), reports_terminal_id: helpers.one(terminals, { relationName: 'reports_terminal_id', fields: [ reports.terminal_id ], references: [ terminals.id ] }), reports_user_id: helpers.one(users, { relationName: 'reports_user_id', fields: [ reports.user_id ], references: [ users.id ] }), reports_items_id: helpers.many(reportsItems, { relationName: 'reports_items_id' }), reports_logs_reports_id: helpers.many(reportsLogs, { relationName: 'reports_logs_reports_id' }) }));