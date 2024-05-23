import { relations } from 'drizzle-orm';
import { rolesPermissions } from './roles-permissions';
import { permissions } from './permissions';
import { roles } from './roles';
import { users } from './users';

export const rolesPermissionsRelations = relations(rolesPermissions, (helpers) => ({ permissions: helpers.one(permissions, { relationName: 'PermissionsToRoles_permissions', fields: [ rolesPermissions.permission_id ], references: [ permissions.id ] }), roles: helpers.one(roles, { relationName: 'RolesToRoles_permissions', fields: [ rolesPermissions.role_id ], references: [ roles.id ] }), users_roles_permissions_created_byTousers: helpers.one(users, { relationName: 'roles_permissions_created_byTousers', fields: [ rolesPermissions.created_by ], references: [ users.id ] }), users_roles_permissions_updated_byTousers: helpers.one(users, { relationName: 'roles_permissions_updated_byTousers', fields: [ rolesPermissions.updated_by ], references: [ users.id ] }) }));