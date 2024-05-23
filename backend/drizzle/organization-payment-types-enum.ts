import { pgEnum } from 'drizzle-orm/pg-core';

export const organizationPaymentTypesEnum = pgEnum('organization_payment_types', ['cash', 'card', 'client']);