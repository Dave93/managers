import { relations } from 'drizzle-orm';
import { permissions } from './permissions';
import { users } from './users';
import { rolesPermissions } from './roles-permissions';
import { usersPermissions } from './users-permissions';

export const permissionsRelations = relations(permissions, (helpers) => ({ users_permissions_updated_byTousers: helpers.one(users, { relationName: 'permissions_updated_byTousers', fields: [ permissions.updated_by ], references: [ users.id ] }), users_permissions_created_byTousers: helpers.one(users, { relationName: 'permissions_created_byTousers', fields: [ permissions.created_by ], references: [ users.id ] }), roles_permissions: helpers.many(rolesPermissions, { relationName: 'PermissionsToRoles_permissions' }), users_permissions: helpers.many(usersPermissions, { relationName: 'PermissionsToUsers_permissions' }) }));