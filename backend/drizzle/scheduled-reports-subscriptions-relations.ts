import { relations } from 'drizzle-orm';
import { scheduledReportsSubscriptions } from './scheduled-reports-subscriptions';
import { scheduledReports } from './scheduled-reports';
import { users } from './users';

export const scheduledReportsSubscriptionsRelations = relations(scheduledReportsSubscriptions, (helpers) => ({ scheduled_reports_subscription_reports: helpers.one(scheduledReports, { relationName: 'Scheduled_reportsToScheduled_reports_subscription', fields: [ scheduledReportsSubscriptions.report_id ], references: [ scheduledReports.id ] }), scheduled_reports_subscription_users: helpers.one(users, { relationName: 'Scheduled_reports_subscriptionToUsers', fields: [ scheduledReportsSubscriptions.user_id ], references: [ users.id ] }) }));