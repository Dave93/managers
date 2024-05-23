import { relations } from 'drizzle-orm';
import { reportsItems } from './reports-items';
import { reports } from './reports';
import { reportGroups } from './report-groups';
import { reportsLogs } from './reports-logs';

export const reportsItemsRelations = relations(reportsItems, (helpers) => ({ reports_id: helpers.one(reports, { relationName: 'reports_items_id', fields: [ reportsItems.report_id, reportsItems.report_date ], references: [ reports.id, reports.date ] }), report_groups_id: helpers.one(reportGroups, { relationName: 'report_groups_id', fields: [ reportsItems.group_id ], references: [ reportGroups.id ] }), reports_logs_reports_item_id: helpers.many(reportsLogs, { relationName: 'reports_logs_reports_item_id' }) }));