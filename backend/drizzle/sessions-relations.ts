import { relations } from 'drizzle-orm';
import { sessions } from './sessions';
import { users } from './users';

export const sessionsRelations = relations(sessions, (helpers) => ({ users_sessions: helpers.one(users, { relationName: 'sessions_users', fields: [ sessions.user_id ], references: [ users.id ] }) }));