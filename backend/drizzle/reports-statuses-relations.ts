import { relations } from 'drizzle-orm';
import { reportsStatuses } from './reports-statuses';
import { reports } from './reports';

export const reportsStatusesRelations = relations(reportsStatuses, (helpers) => ({ reports_status_id: helpers.many(reports, { relationName: 'reports_status_id' }) }));