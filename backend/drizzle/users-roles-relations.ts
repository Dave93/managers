import { relations } from 'drizzle-orm';
import { usersRoles } from './users-roles';
import { roles } from './roles';
import { users } from './users';

export const usersRolesRelations = relations(usersRoles, (helpers) => ({ roles: helpers.one(roles, { relationName: 'RolesToUsers_roles', fields: [ usersRoles.role_id ], references: [ roles.id ] }), users_usersTousers_roles_created_by: helpers.one(users, { relationName: 'usersTousers_roles_created_by', fields: [ usersRoles.created_by ], references: [ users.id ] }), users_usersTousers_roles_updated_by: helpers.one(users, { relationName: 'usersTousers_roles_updated_by', fields: [ usersRoles.updated_by ], references: [ users.id ] }), users_usersTousers_roles_user_id: helpers.one(users, { relationName: 'usersTousers_roles_user_id', fields: [ usersRoles.user_id ], references: [ users.id ] }) }));