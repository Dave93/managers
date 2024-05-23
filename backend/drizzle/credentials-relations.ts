import { relations } from 'drizzle-orm';
import { credentials } from './credentials';
import { users } from './users';

export const credentialsRelations = relations(credentials, (helpers) => ({ credentials_created_byTousers: helpers.one(users, { relationName: 'credentials_created_byTousers', fields: [ credentials.created_by ], references: [ users.id ] }), credentials_updated_byTousers: helpers.one(users, { relationName: 'credentials_updated_byTousers', fields: [ credentials.updated_by ], references: [ users.id ] }) }));