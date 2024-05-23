import { relations } from 'drizzle-orm';
import { reportGroups } from './report-groups';
import { reportsItems } from './reports-items';

export const reportGroupsRelations = relations(reportGroups, (helpers) => ({ parent_id_report_groups: helpers.one(reportGroups, { relationName: 'report_groups_id', fields: [ reportGroups.parent_id ], references: [ reportGroups.id ] }), report_groups_id: helpers.many(reportGroups, { relationName: 'report_groups_id' }), reports_items_id: helpers.many(reportsItems, { relationName: 'report_groups_id' }) }));