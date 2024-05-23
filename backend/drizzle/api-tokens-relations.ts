import { relations } from 'drizzle-orm';
import { apiTokens } from './api-tokens';
import { users } from './users';
import { organizations } from './organizations';

export const apiTokensRelations = relations(apiTokens, (helpers) => ({ api_tokens_created_byTousers: helpers.one(users, { relationName: 'api_tokens_created_byTousers', fields: [ apiTokens.created_by ], references: [ users.id ] }), api_tokens_organization: helpers.one(organizations, { relationName: 'Api_tokensToOrganization', fields: [ apiTokens.organization_id ], references: [ organizations.id ] }), api_tokens_updated_byTousers: helpers.one(users, { relationName: 'api_tokens_updated_byTousers', fields: [ apiTokens.updated_by ], references: [ users.id ] }) }));