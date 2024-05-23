import { relations } from 'drizzle-orm';
import { organizations } from './organizations';
import { apiTokens } from './api-tokens';
import { users } from './users';
import { terminals } from './terminals';
import { workSchedules } from './work-schedules';

export const organizationsRelations = relations(organizations, (helpers) => ({ api_tokens_organization: helpers.many(apiTokens, { relationName: 'Api_tokensToOrganization' }), organization_created_byTousers: helpers.one(users, { relationName: 'organization_created_byTousers', fields: [ organizations.created_by ], references: [ users.id ] }), organization_updated_byTousers: helpers.one(users, { relationName: 'organization_updated_byTousers', fields: [ organizations.updated_by ], references: [ users.id ] }), terminals_organization_idTorganization: helpers.many(terminals, { relationName: 'terminals_organization_idTorganization' }), work_schedules_organization_idTorganization: helpers.many(workSchedules, { relationName: 'work_schedules_organization_idTorganization' }) }));