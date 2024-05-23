import { pgTable, text } from 'drizzle-orm/pg-core';

export const usersTerminals = pgTable('users_terminals', { user_id: text('user_id').notNull(), terminal_id: text('terminal_id').notNull() });