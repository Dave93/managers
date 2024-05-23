import { relations } from 'drizzle-orm';
import { terminals } from './terminals';
import { reports } from './reports';
import { organizations } from './organizations';
import { usersTerminals } from './users-terminals';

export const terminalsRelations = relations(terminals, (helpers) => ({ reports_terminal_id: helpers.many(reports, { relationName: 'reports_terminal_id' }), organization: helpers.one(organizations, { relationName: 'terminals_organization_idTorganization', fields: [ terminals.organization_id ], references: [ organizations.id ] }), users_terminals: helpers.many(usersTerminals, { relationName: 'TerminalsToUsers_terminals' }) }));