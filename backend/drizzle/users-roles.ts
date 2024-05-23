import { pgTable, text } from 'drizzle-orm/pg-core';

export const usersRoles = pgTable('users_roles', { user_id: text('user_id').notNull(), role_id: text('role_id').notNull(), created_by: text('created_by'), updated_by: text('updated_by') });