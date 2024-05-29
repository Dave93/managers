import { pgTable, pgEnum, uuid, varchar, timestamp, boolean, numeric, integer, uniqueIndex, text, doublePrecision, index, time, primaryKey } from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"

export const organization_payment_types = pgEnum("organization_payment_types", ['cash', 'card', 'client'])
export const organization_system_type = pgEnum("organization_system_type", ['iiko', 'r_keeper', 'jowi'])
export const report_item_type = pgEnum("report_item_type", ['income', 'outcome'])
export const report_status = pgEnum("report_status", ['sent', 'checking', 'comfirmed', 'cancelled'])
export const user_status = pgEnum("user_status", ['active', 'blocked', 'inactive'])
export const work_schedule_entry_status = pgEnum("work_schedule_entry_status", ['open', 'closed'])


export const invoices = pgTable("invoices", {
    id: uuid("id").notNull(),
    incomingDocumentNumber: varchar("incomingDocumentNumber", { length: 255 }),
    incomingDate: timestamp("incomingDate", { precision: 5, withTimezone: true, mode: 'string' }).notNull(),
    useDefaultDocumentTime: boolean("useDefaultDocumentTime").default(false),
    dueDate: timestamp("dueDate", { precision: 5, withTimezone: true, mode: 'string' }),
    supplier: uuid("supplier"),
    defaultStore: uuid("defaultStore"),
    invoice: varchar("invoice", { length: 255 }),
    documentNumber: varchar("documentNumber", { length: 255 }),
    comment: varchar("comment", { length: 255 }),
    status: varchar("status", { length: 255 }),
    type: varchar("type", { length: 255 }),
    accountToCode: varchar("accountToCode", { length: 255 }),
    revenueAccountCode: varchar("revenueAccountCode", { length: 255 }),
    defaultStoreId: varchar("defaultStoreId", { length: 255 }),
    defaultStoreCode: varchar("defaultStoreCode", { length: 255 }),
    counteragentId: varchar("counteragentId", { length: 255 }),
    counteragentCode: varchar("counteragentCode", { length: 255 }),
    linkedIncomingInvoiceId: varchar("linkedIncomingInvoiceId", { length: 255 }),
});

export const invoice_items = pgTable("invoice_items", {
    id: uuid("id").defaultRandom().notNull(),
    isAdditionalExpense: boolean("isAdditionalExpense").default(false),
    actualAmount: numeric("actualAmount", { precision: 10, scale: 4 }),
    price: integer("price"),
    sum: integer("sum"),
    vatPercent: integer("vatPercent"),
    vatSum: integer("vatSum"),
    discountSum: integer("discountSum"),
    amountUnit: uuid("amountUnit"),
    num: varchar("num", { length: 255 }),
    productArticle: varchar("productArticle", { length: 255 }),
    amount: numeric("amount", { precision: 10, scale: 4 }),
    invoice_id: uuid("invoice_id"),
    priceWithoutVat: integer("priceWithoutVat"),
    priceUnit: varchar("priceUnit", { length: 255 }),
    supplierProduct: varchar("supplierProduct", { length: 255 }),
    supplierProductArticle: varchar("supplierProductArticle", { length: 255 }),
    storeId: uuid("storeId"),
    storeCode: varchar("storeCode", { length: 255 }),
    productId: uuid("productId"),
    invoiceincomingdate: timestamp("invoiceincomingdate", { precision: 5, withTimezone: true, mode: 'string' }).notNull(),
});

export const api_tokens = pgTable("api_tokens", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    active: boolean("active").default(false).notNull(),
    token: text("token").notNull(),
    organization_id: uuid("organization_id").notNull(),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    created_by: uuid("created_by"),
    updated_by: uuid("updated_by"),
},
    (table) => {
        return {
            id_key: uniqueIndex("api_tokens_id_key").on(table.id),
            token_key: uniqueIndex("api_tokens_token_key").on(table.token),
        }
    });

export const accounting_category = pgTable("accounting_category", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 255 }).notNull(),
});

export const balance_store = pgTable("balance_store", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    storeId: uuid("storeId"),
    productId: uuid("productId"),
    amount: doublePrecision("amount").default(10.1),
    sum: doublePrecision("sum").default(10.1),
    enddate: timestamp("enddate", { precision: 5, withTimezone: true, mode: 'string' }),
});

export const conception = pgTable("conception", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 255 }).notNull(),
});

export const corporation_department = pgTable("corporation_department", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    parentId: varchar("parentId", { length: 255 }),
    name: varchar("name", { length: 255 }),
    type: varchar("type", { length: 255 }),
});

export const corporation_groups = pgTable("corporation_groups", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: varchar("name", { length: 255 }),
    departmentId: uuid("departmentId"),
    groupServiceMode: varchar("groupServiceMode", { length: 255 }),
});

export const corporation_store = pgTable("corporation_store", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    parentId: varchar("parentId", { length: 255 }),
    code: varchar("code", { length: 255 }),
    name: varchar("name", { length: 255 }),
    type: varchar("type", { length: 255 }),
});

export const corporation_terminals = pgTable("corporation_terminals", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: varchar("name", { length: 255 }),
    computerName: varchar("computerName", { length: 255 }),
    anonymous: varchar("anonymous", { length: 255 }),
});

export const credentials = pgTable("credentials", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    key: text("key").notNull(),
    model: text("model").notNull(),
    type: text("type").notNull(),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    created_by: uuid("created_by"),
    updated_by: uuid("updated_by"),
    model_id: text("model_id").notNull(),
});

export const discount_type = pgTable("discount_type", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 255 }),
});

export const measure_unit = pgTable("measure_unit", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    deleted: boolean("deleted").default(false),
    name: varchar("name", { length: 255 }),
    code: varchar("code", { length: 255 }),
});

export const nomenclature_category = pgTable("nomenclature_category", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    deleted: boolean("deleted").default(false),
    name: varchar("name", { length: 255 }),
    code: varchar("code", { length: 255 }),
});

export const nomenclature_element = pgTable("nomenclature_element", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    deleted: boolean("deleted").default(false),
    name: varchar("name", { length: 255 }),
    code: varchar("code", { length: 255 }),
    num: varchar("num", { length: 255 }),
    tax_category_id: uuid("tax_category_id"),
    category_id: uuid("category_id"),
    accounting_category_id: uuid("accounting_category_id"),
    mainUnit: uuid("mainUnit").defaultRandom(),
    type: varchar("type", { length: 255 }),
    unitWeight: numeric("unitWeight", { precision: 10, scale: 4 }),
    unitCapacity: numeric("unitCapacity", { precision: 10, scale: 4 }),
});

export const nomenclature_element_group = pgTable("nomenclature_element_group", {
    id: uuid("id").defaultRandom().notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 255 }).notNull(),
    nomenclature_group_id: uuid("nomenclature_group_id"),
});

export const nomenclature_group = pgTable("nomenclature_group", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    tax_category_id: uuid("tax_category_id"),
    category_id: uuid("category_id"),
    accounting_category_id: uuid("accounting_category_id"),
    parent_id: uuid("parent_id").defaultRandom().notNull(),
});

export const order_type = pgTable("order_type", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 255 }),
});

export const organization = pgTable("organization", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: text("name").notNull(),
    active: boolean("active").default(true).notNull(),
    phone: text("phone"),
    description: text("description"),
    icon_url: text("icon_url"),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    created_by: uuid("created_by"),
    updated_by: uuid("updated_by"),
    code: text("code"),
});

export const payment_type = pgTable("payment_type", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    name: varchar("name", { length: 255 }),
    code: varchar("code", { length: 255 }),
});

export const permissions = pgTable("permissions", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    slug: varchar("slug", { length: 160 }).notNull(),
    description: varchar("description", { length: 60 }).notNull(),
    active: boolean("active").default(true).notNull(),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    created_by: uuid("created_by"),
    updated_by: uuid("updated_by"),
},
    (table) => {
        return {
            UQ_d090ad82a0e97ce764c06c7b312: uniqueIndex("UQ_d090ad82a0e97ce764c06c7b312").on(table.slug),
        }
    });

export const report_groups = pgTable("report_groups", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    parent_id: uuid("parent_id"),
});

export const report_olap = pgTable("report_olap", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    dateTime: timestamp("dateTime", { precision: 5, withTimezone: true, mode: 'string' }),
    productId: uuid("productId"),
    productName: varchar("productName", { length: 255 }),
    productType: varchar("productType", { length: 255 }),
    sessionGroup: varchar("sessionGroup", { length: 255 }),
    transactionType: varchar("transactionType", { length: 255 }),
    amauntOut: doublePrecision("amauntOut").default(10.1),
});

export const reports_status = pgTable("reports_status", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    code: varchar("code", { length: 255 }).notNull(),
    color: varchar("color", { length: 255 }).notNull(),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    label: varchar("label", { length: 255 }).notNull(),
});

export const roles = pgTable("roles", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: varchar("name", { length: 50 }).notNull(),
    code: varchar("code", { length: 50 }),
    active: boolean("active").default(true).notNull(),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    created_by: uuid("created_by"),
    updated_by: uuid("updated_by"),
},
    (table) => {
        return {
            UQ_0e2c0e1b4b0b0b0b0b0b0b0b0b0: uniqueIndex("UQ_0e2c0e1b4b0b0b0b0b0b0b0b0b0").on(table.code),
            UQ_648e3f5447f725579d7d4ffdfb7: uniqueIndex("UQ_648e3f5447f725579d7d4ffdfb7").on(table.name),
        }
    });

export const scheduled_reports = pgTable("scheduled_reports", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    cron: text("cron").notNull(),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const scheduled_reports_subscription = pgTable("scheduled_reports_subscription", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    report_id: uuid("report_id").notNull(),
    user_id: uuid("user_id").notNull(),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    user_id: uuid("user_id").notNull(),
    user_agent: text("user_agent").notNull(),
    device_name: text("device_name").notNull(),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const settings = pgTable("settings", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    is_secure: boolean("is_secure").default(false).notNull(),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
},
    (table) => {
        return {
            key_key: uniqueIndex("settings_key_key").on(table.key),
        }
    });

export const suppliers = pgTable("suppliers", {
    id: uuid("id").primaryKey().notNull(),
    code: varchar("code", { length: 255 }),
    name: varchar("name", { length: 255 }),
    cardNumber: varchar("cardNumber", { length: 255 }),
    taxpayerIdNumber: varchar("taxpayerIdNumber", { length: 255 }),
    snils: varchar("snils", { length: 255 }),
    departmentCodes: varchar("departmentCodes"),
    responsibilityDepartmentCodes: varchar("responsibilityDepartmentCodes"),
    deleted: boolean("deleted"),
    supplier: boolean("supplier"),
    employee: boolean("employee"),
    client: boolean("client"),
    representsStore: boolean("representsStore"),
    representedStoreId: uuid("representedStoreId"),
});

export const tax_category = pgTable("tax_category", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 255 }),
});

export const terminals = pgTable("terminals", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: text("name").notNull(),
    active: boolean("active").default(true).notNull(),
    phone: text("phone"),
    address: text("address"),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    organization_id: uuid("organization_id").notNull(),
    manager_name: text("manager_name"),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const timesheet = pgTable("timesheet", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    user_id: uuid("user_id").notNull(),
    is_late: boolean("is_late").default(false).notNull(),
    date: timestamp("date", { precision: 5, withTimezone: true, mode: 'string' }).notNull(),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const users = pgTable("users", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    phone: varchar("phone", { length: 20 }),
    email: varchar("email", { length: 100 }),
    login: varchar("login", { length: 100 }).notNull(),
    first_name: varchar("first_name", { length: 100 }),
    last_name: varchar("last_name", { length: 100 }),
    password: varchar("password").notNull(),
    salt: varchar("salt"),
    is_super_user: boolean("is_super_user").default(false).notNull(),
    status: user_status("status").notNull(),
    birth_date: timestamp("birth_date", { precision: 5, withTimezone: true, mode: 'string' }),
    is_online: boolean("is_online").default(false).notNull(),
    fcm_token: varchar("fcm_token", { length: 250 }),
    doc_files: text("doc_files").array(),
    app_version: varchar("app_version", { length: 100 }),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    api_token: varchar("api_token", { length: 250 }),
    tg_id: varchar("tg_id", { length: 250 }),
},
    (table) => {
        return {
            UQ_0e2c0e1b3b0b0b0b0b0b0b0b0b0: uniqueIndex("UQ_0e2c0e1b3b0b0b0b0b0b0b0b0b0").on(table.login),
            UQ_0e2c0e1b4b5b0b0b0b0b0b0b0b0: uniqueIndex("UQ_0e2c0e1b4b5b0b0b0b0b0b0b0b0").on(table.email),
            UQ_a000cca60bcf04454e727699490: uniqueIndex("UQ_a000cca60bcf04454e727699490").on(table.phone),
            fki_users_login: index("fki_users_login").on(table.login),
        }
    });

export const users_stores = pgTable("users_stores", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    user_id: uuid("user_id"),
    corporation_store_id: uuid("corporation_store_id"),
});

export const work_schedule_entries = pgTable("work_schedule_entries", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    user_id: uuid("user_id").notNull(),
    work_schedule_id: uuid("work_schedule_id").notNull(),
    date_start: timestamp("date_start", { precision: 5, withTimezone: true, mode: 'string' }).notNull(),
    date_finish: timestamp("date_finish", { precision: 5, withTimezone: true, mode: 'string' }),
    duration: integer("duration").default(0).notNull(),
    ip_open: text("ip_open"),
    ip_close: text("ip_close"),
    lat_open: doublePrecision("lat_open").notNull(),
    lat_close: doublePrecision("lat_close"),
    lon_open: doublePrecision("lon_open").notNull(),
    lon_close: doublePrecision("lon_close"),
    current_status: work_schedule_entry_status("current_status").default('open').notNull(),
    late: boolean("late").default(false).notNull(),
    created_at: timestamp("created_at", { precision: 5, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, mode: 'string' }).defaultNow().notNull(),
    created_by: uuid("created_by"),
    updated_by: uuid("updated_by"),
},
    (table) => {
        return {
            fki_work_schedule_entries_current_status: index("fki_work_schedule_entries_current_status").on(table.current_status),
            fki_work_schedule_entries_user_id: index("fki_work_schedule_entries_user_id").on(table.user_id),
        }
    });

export const work_schedules = pgTable("work_schedules", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: text("name").notNull(),
    active: boolean("active").default(true).notNull(),
    organization_id: uuid("organization_id").notNull(),
    days: text("days").array(),
    start_time: time("start_time", { precision: 5, withTimezone: true }).notNull(),
    end_time: time("end_time", { precision: 5, withTimezone: true }).notNull(),
    max_start_time: time("max_start_time", { precision: 5, withTimezone: true }).notNull(),
    bonus_price: integer("bonus_price").default(0).notNull(),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    created_by: uuid("created_by"),
    updated_by: uuid("updated_by"),
});

export const writeoff = pgTable("writeoff", {
    id: uuid("id").notNull(),
    dateIncoming: timestamp("dateincoming", { precision: 5, withTimezone: true, mode: 'string' }).notNull(),
    documnentNumber: varchar("documnentNumber", { length: 255 }),
    status: varchar("status", { length: 255 }),
    conceptionId: uuid("conceptionId"),
    comment: varchar("comment", { length: 255 }),
    storeId: uuid("storeId"),
});

export const writeoff_items = pgTable("writeoff_items", {
    productId: uuid("productId"),
    productSizeId: varchar("productSizeId", { length: 255 }),
    amountFactor: integer("amountFactor"),
    amount: numeric("amount", { precision: 10, scale: 4 }),
    measureUnitId: uuid("measureUnitId"),
    containerId: varchar("containerId", { length: 255 }),
    cost: integer("cost"),
    writeoff_id: uuid("writeoff_id"),
    writeoffincomingdate: timestamp("writeoffincomingdate", { precision: 5, withTimezone: true, mode: 'string' }).notNull(),
    id: uuid("id").defaultRandom().notNull(),
});

export const users_terminals = pgTable("users_terminals", {
    user_id: uuid("user_id").notNull(),
    terminal_id: uuid("terminal_id").notNull(),
},
    (table) => {
        return {
            PK_users_terminals_id: primaryKey({ columns: [table.user_id, table.terminal_id], name: "PK_users_terminals_id" }),
        }
    });

export const users_work_schedules = pgTable("users_work_schedules", {
    user_id: uuid("user_id").notNull(),
    work_schedule_id: uuid("work_schedule_id").notNull(),
},
    (table) => {
        return {
            PK_users_work_schedules_id: primaryKey({ columns: [table.user_id, table.work_schedule_id], name: "PK_users_work_schedules_id" }),
        }
    });

export const roles_permissions = pgTable("roles_permissions", {
    role_id: uuid("role_id").notNull(),
    permission_id: uuid("permission_id").notNull(),
    created_by: uuid("created_by"),
    updated_by: uuid("updated_by"),
},
    (table) => {
        return {
            PK_0cd11f0b35c4d348c6ebb9b36b7: primaryKey({ columns: [table.role_id, table.permission_id], name: "PK_0cd11f0b35c4d348c6ebb9b36b7" }),
        }
    });

export const users_permissions = pgTable("users_permissions", {
    user_id: uuid("user_id").notNull(),
    permission_id: uuid("permission_id").notNull(),
    created_by: uuid("created_by"),
    updated_by: uuid("updated_by"),
},
    (table) => {
        return {
            PK_7f3736984cd8546a1e418005561: primaryKey({ columns: [table.user_id, table.permission_id], name: "PK_7f3736984cd8546a1e418005561" }),
        }
    });

export const users_roles = pgTable("users_roles", {
    user_id: uuid("user_id").notNull(),
    role_id: uuid("role_id").notNull(),
    created_by: uuid("created_by"),
    updated_by: uuid("updated_by"),
},
    (table) => {
        return {
            PK_c525e9373d63035b9919e578a9c: primaryKey({ columns: [table.user_id, table.role_id], name: "PK_c525e9373d63035b9919e578a9c" }),
        }
    });

export const usersToUsersRelations = relations(users_roles, ({ one }) => ({
    role: one(roles, {
        fields: [users_roles.role_id],
        references: [roles.id],
    }),
    user: one(users, {
        fields: [users_roles.user_id],
        references: [users.id],
    }),
}));

export const internal_transfer = pgTable("internal_transfer", {
    id: uuid("id").defaultRandom().notNull(),
    dateIncoming: timestamp("dateIncoming", { precision: 5, withTimezone: true, mode: 'string' }).notNull(),
    documentNumber: varchar("documentnumber", { length: 255 }),
    status: varchar("status", { length: 255 }),
    conceptionId: uuid("conceptionId"),
    storeFromId: uuid("storeFromId"),
    storeToId: uuid("storeToId"),
},
    (table) => {
        return {
            internal_transfer_pkey: primaryKey({ columns: [table.id, table.dateIncoming], name: "internal_transfer_pkey" }),
        }
    });

export const internal_transfer_items = pgTable("internal_transfer_items", {
    id: uuid("id").defaultRandom().notNull(),
    productId: uuid("productId"),
    amount: numeric("amount", { precision: 10, scale: 4 }),
    measureUnitId: uuid("measureUnitId"),
    containerId: varchar("containerId", { length: 255 }),
    cost: integer("cost"),
    internal_transfer_id: uuid("internal_transfer_id"),
    num: varchar("num", { length: 255 }),
    internaltransferdate: timestamp("internaltransferdate", { precision: 5, withTimezone: true, mode: 'string' }).notNull(),
},
    (table) => {
        return {
            internalTransferItems_pkey: primaryKey({ columns: [table.id, table.internaltransferdate], name: "internalTransferItems_pkey" }),
        }
    });

export const reports = pgTable("reports", {
    id: uuid("id").defaultRandom().notNull(),
    date: timestamp("date", { precision: 5, withTimezone: true, mode: 'string' }).notNull(),
    status_id: uuid("status_id").notNull(),
    user_id: uuid("user_id").notNull(),
    terminal_id: uuid("terminal_id").notNull(),
    cash_ids: text("cash_ids").array(),
    total_amount: integer("total_amount").default(0).notNull(),
    total_manager_price: integer("total_manager_price").default(0).notNull(),
    difference: integer("difference").default(0).notNull(),
    arryt_income: integer("arryt_income").default(0).notNull(),
},
    (table) => {
        return {
            reports_pkey: primaryKey({ columns: [table.id, table.date], name: "reports_pkey" }),
        }
    });

export const reports_items = pgTable("reports_items", {
    id: uuid("id").defaultRandom().notNull(),
    report_id: uuid("report_id").notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    type: report_item_type("type").notNull(),
    amount: integer("amount").default(0),
    source: varchar("source", { length: 255 }).notNull(),
    group_id: uuid("group_id"),
    report_date: timestamp("report_date", { precision: 5, withTimezone: true, mode: 'string' }).notNull(),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
},
    (table) => {
        return {
            reports_items_pkey: primaryKey({ columns: [table.id, table.report_date], name: "reports_items_pkey" }),
        }
    });

export const reports_logs = pgTable("reports_logs", {
    id: uuid("id").defaultRandom().notNull(),
    reports_id: uuid("reports_id").notNull(),
    reports_item_id: uuid("reports_item_id").notNull(),
    before_json: text("before_json"),
    after_json: text("after_json"),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    user_id: uuid("user_id").notNull(),
    before_text: text("before_text"),
    after_text: text("after_text"),
    report_date: timestamp("report_date", { precision: 5, withTimezone: true, mode: 'string' }).notNull(),
},
    (table) => {
        return {
            reports_logs_pkey: primaryKey({ columns: [table.id, table.report_date], name: "reports_logs_pkey" }),
        }
    });

export const product_groups = pgTable("product_groups", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    sort: integer("sort").default(0).notNull(),
    organization_id: uuid("organization_id").notNull(),
    show_inventory: boolean("show_inventory").default(true),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const product_group_items = pgTable("product_group_items", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    product_group_id: uuid("product_group_id").notNull(),
    product_id: uuid("product_id").notNull(),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const nomenclature_element_organization = pgTable("nomenclature_element_organization", {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    nomenclature_element_id: uuid("nomenclature_element_id").notNull(),
    organization_id: uuid("organization_id").notNull(),
    created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const nomenclatureElementToOrganization = relations(nomenclature_element_organization, ({ one }) => ({
    nomenclatureElement: one(nomenclature_element, {
        fields: [nomenclature_element_organization.nomenclature_element_id],
        references: [nomenclature_element.id],
    }),
    organization: one(organization, {
        fields: [nomenclature_element_organization.organization_id],
        references: [organization.id],
    }),
}));