import { relations } from 'drizzle-orm';
import { roles } from './roles';
import { users } from './users';
import { rolesPermissions } from './roles-permissions';
import { usersRoles } from './users-roles';

export const rolesRelations = relations(roles, (helpers) => ({ users_roles_created_byTousers: helpers.one(users, { relationName: 'roles_created_byTousers', fields: [ roles.created_by ], references: [ users.id ] }), users_roles_updated_byTousers: helpers.one(users, { relationName: 'roles_updated_byTousers', fields: [ roles.updated_by ], references: [ users.id ] }), roles_permissions: helpers.many(rolesPermissions, { relationName: 'RolesToRoles_permissions' }), users_roles: helpers.many(usersRoles, { relationName: 'RolesToUsers_roles' }) }));