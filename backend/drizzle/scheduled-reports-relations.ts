import { relations } from 'drizzle-orm';
import { scheduledReports } from './scheduled-reports';
import { scheduledReportsSubscriptions } from './scheduled-reports-subscriptions';

export const scheduledReportsRelations = relations(scheduledReports, (helpers) => ({ scheduled_reports_scheduled_reports_subscriptions: helpers.many(scheduledReportsSubscriptions, { relationName: 'Scheduled_reportsToScheduled_reports_subscription' }) }));