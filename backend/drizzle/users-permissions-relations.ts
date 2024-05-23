import { relations } from 'drizzle-orm';
import { usersPermissions } from './users-permissions';
import { users } from './users';
import { permissions } from './permissions';

export const usersPermissionsRelations = relations(usersPermissions, (helpers) => ({ users_usersTousers_permissions_created_by: helpers.one(users, { relationName: 'usersTousers_permissions_created_by', fields: [ usersPermissions.created_by ], references: [ users.id ] }), users_usersTousers_permissions_user_id: helpers.one(users, { relationName: 'usersTousers_permissions_user_id', fields: [ usersPermissions.user_id ], references: [ users.id ] }), users_usersTousers_permissions_updated_by: helpers.one(users, { relationName: 'usersTousers_permissions_updated_by', fields: [ usersPermissions.updated_by ], references: [ users.id ] }), permissions: helpers.one(permissions, { relationName: 'PermissionsToUsers_permissions', fields: [ usersPermissions.permission_id ], references: [ permissions.id ] }) }));