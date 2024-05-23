import { pgEnum } from 'drizzle-orm/pg-core';

export const organizationSystemTypeEnum = pgEnum('organization_system_type', ['iiko', 'r_keeper', 'jowi']);