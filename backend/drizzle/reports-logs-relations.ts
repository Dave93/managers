import { relations } from 'drizzle-orm';
import { reportsLogs } from './reports-logs';
import { reports } from './reports';
import { reportsItems } from './reports-items';
import { users } from './users';

export const reportsLogsRelations = relations(reportsLogs, (helpers) => ({ reports_logs_reports_id: helpers.one(reports, { relationName: 'reports_logs_reports_id', fields: [ reportsLogs.reports_id, reportsLogs.report_date ], references: [ reports.id, reports.date ] }), reports_logs_reports_item_id: helpers.one(reportsItems, { relationName: 'reports_logs_reports_item_id', fields: [ reportsLogs.reports_item_id, reportsLogs.report_date ], references: [ reportsItems.id, reportsItems.report_date ] }), reports_logs_user_id: helpers.one(users, { relationName: 'reports_logs_user_id', fields: [ reportsLogs.user_id ], references: [ users.id ] }) }));