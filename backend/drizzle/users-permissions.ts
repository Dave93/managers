import { pgTable, text } from 'drizzle-orm/pg-core';

export const usersPermissions = pgTable('users_permissions', { user_id: text('user_id').notNull(), permission_id: text('permission_id').notNull(), created_by: text('created_by'), updated_by: text('updated_by') });