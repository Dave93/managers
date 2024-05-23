import { pgTable, text } from 'drizzle-orm/pg-core';

export const rolesPermissions = pgTable('roles_permissions', { role_id: text('role_id').notNull(), permission_id: text('permission_id').notNull(), created_by: text('created_by'), updated_by: text('updated_by') });