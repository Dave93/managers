import { relations } from 'drizzle-orm';
import { usersTerminals } from './users-terminals';
import { terminals } from './terminals';
import { users } from './users';

export const usersTerminalsRelations = relations(usersTerminals, (helpers) => ({ terminals: helpers.one(terminals, { relationName: 'TerminalsToUsers_terminals', fields: [ usersTerminals.terminal_id ], references: [ terminals.id ] }), users: helpers.one(users, { relationName: 'UsersToUsers_terminals', fields: [ usersTerminals.user_id ], references: [ users.id ] }) }));