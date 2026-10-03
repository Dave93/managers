import {
  pgTable,
  bigint,
  pgEnum,
  uuid,
  varchar,
  timestamp,
  boolean,
  numeric,
  integer,
  uniqueIndex,
  text,
  doublePrecision,
  index,
  time,
  primaryKey,
  serial,
  jsonb,
  pgView,
  decimal,
  pgMaterializedView,
  date,
  check,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const organization_payment_types = pgEnum("organization_payment_types", [
  "cash",
  "card",
  "client",
]);
export const organization_system_type = pgEnum("organization_system_type", [
  "iiko",
  "r_keeper",
  "jowi",
]);
export const report_item_type = pgEnum("report_item_type", [
  "income",
  "outcome",
]);
export const report_status = pgEnum("report_status", [
  "sent",
  "checking",
  "comfirmed",
  "cancelled",
]);
export const user_status = pgEnum("user_status", [
  "active",
  "blocked",
  "inactive",
]);
export const work_schedule_entry_status = pgEnum("work_schedule_entry_status", [
  "open",
  "closed",
]);

export const vacancyStatusEnumV2 = pgEnum('vacancy_status_v2', [
  "open",
  "in_progress",
  "found_candidates",
  "interview",
  "closed",
  "cancelled",
]);

export const interviewStatusEnum = pgEnum('interview_status', [
  'scheduled',
  'completed',
  'cancelled',
  'pending'
]);

// результат собеседования
export const interviewResultEnum = pgEnum('interview_result', [
  'positive',
  'negative',
  'neutral',
]);

export const attestation_question_type = pgEnum("attestation_question_type", [
  "single",
  "multi",
]);
export const attestation_attempt_status = pgEnum("attestation_attempt_status", [
  "in_progress",
  "submitted",
  "expired",
]);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").notNull(),
    incomingDocumentNumber: varchar("incomingDocumentNumber", { length: 255 }),
    incomingDate: timestamp("incomingDate", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    useDefaultDocumentTime: boolean("useDefaultDocumentTime").default(false),
    dueDate: timestamp("dueDate", { withTimezone: true, mode: "string" }),
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
    linkedIncomingInvoiceId: varchar("linkedIncomingInvoiceId", {
      length: 255,
    }),
  },
  (table) => {
    return {
      PK_invoices: primaryKey({ columns: [table.id, table.incomingDate] }),
    };
  }
);

export const invoice_items = pgTable(
  "invoice_items",
  {
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
    invoiceincomingdate: timestamp("invoiceincomingdate", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
  },
  (table) => {
    return {
      PK_invoice_items: primaryKey({
        columns: [table.id, table.invoiceincomingdate],
      }),
    };
  }
);

export const api_tokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    active: boolean("active").default(false).notNull(),
    token: text("token").notNull(),
    organization_id: uuid("organization_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    created_by: uuid("created_by"),
    updated_by: uuid("updated_by"),
  },
  (table) => {
    return {
      id_key: uniqueIndex("api_tokens_id_key").on(table.id),
      token_key: uniqueIndex("api_tokens_token_key").on(table.token),
    };
  }
);

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
  enddate: timestamp("enddate", { withTimezone: true, mode: "string" }),
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
  organization_id: uuid("organization_id"),
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
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
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
  parent_id: uuid("parent_id"),
});

export const nomenclature_element_group = pgTable(
  "nomenclature_element_group",
  {
    id: uuid("id").defaultRandom().notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 255 }).notNull(),
    nomenclature_group_id: uuid("nomenclature_group_id"),
  }
);

export const nomenclature_group = pgTable("nomenclature_group", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  deleted: boolean("deleted").default(false).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  tax_category_id: uuid("tax_category_id"),
  category_id: uuid("category_id"),
  accounting_category_id: uuid("accounting_category_id"),
  parent_id: uuid("parent_id"),
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
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
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

export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    slug: varchar("slug", { length: 160 }).notNull(),
    description: varchar("description", { length: 60 }).notNull(),
    active: boolean("active").default(true).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    created_by: uuid("created_by"),
    updated_by: uuid("updated_by"),
  },
  (table) => {
    return {
      UQ_d090ad82a0e97ce764c06c7b312: uniqueIndex(
        "UQ_d090ad82a0e97ce764c06c7b312"
      ).on(table.slug),
    };
  }
);

export const report_olap = pgTable("report_olap", {
  id: uuid("id").defaultRandom(),
  dateTime: timestamp("dateTime", { withTimezone: true, mode: "string" }),
  productId: uuid("productId"),
  productName: varchar("productName", { length: 255 }),
  productType: varchar("productType", { length: 255 }),
  sessionGroup: varchar("sessionGroup", { length: 255 }),
  transactionType: varchar("transactionType", { length: 255 }),
  amauntOut: doublePrecision("amauntOut").default(10.1),
  store: varchar("store", { length: 255 }),
  productNum: varchar("productNum", { length: 255 }),
  productUnit: varchar("productUnit", { length: 255 }),
});

export const reports_status = pgTable("reports_status", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  code: varchar("code", { length: 255 }).notNull(),
  color: varchar("color", { length: 255 }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  label: varchar("label", { length: 255 }).notNull(),
});

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: varchar("name", { length: 50 }).notNull(),
    code: varchar("code", { length: 50 }),
    active: boolean("active").default(true).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    created_by: uuid("created_by"),
    updated_by: uuid("updated_by"),
  },
  (table) => {
    return {
      UQ_0e2c0e1b4b0b0b0b0b0b0b0b0b0: uniqueIndex(
        "UQ_0e2c0e1b4b0b0b0b0b0b0b0b0b0"
      ).on(table.code),
      UQ_648e3f5447f725579d7d4ffdfb7: uniqueIndex(
        "UQ_648e3f5447f725579d7d4ffdfb7"
      ).on(table.name),
    };
  }
);

export const scheduled_reports = pgTable("scheduled_reports", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  cron: text("cron").notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const scheduled_reports_subscription = pgTable(
  "scheduled_reports_subscription",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    report_id: uuid("report_id").notNull(),
    user_id: uuid("user_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  }
);

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  user_id: uuid("user_id").notNull(),
  user_agent: text("user_agent").notNull(),
  device_name: text("device_name").notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const settings = pgTable(
  "settings",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    is_secure: boolean("is_secure").default(false).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      key_key: uniqueIndex("settings_key_key").on(table.key),
    };
  }
);

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
  playground_enabled: boolean("playground_enabled").default(false).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const timesheet = pgTable("timesheet", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  user_id: uuid("user_id").notNull(),
  is_late: boolean("is_late").default(false).notNull(),
  date: timestamp("date", { withTimezone: true, mode: "string" }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const users = pgTable(
  "users",
  {
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
    birth_date: timestamp("birth_date", { withTimezone: true, mode: "string" }),
    is_online: boolean("is_online").default(false).notNull(),
    fcm_token: varchar("fcm_token", { length: 250 }),
    doc_files: text("doc_files").array(),
    app_version: varchar("app_version", { length: 100 }),
    role_id: uuid("role_id"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    api_token: varchar("api_token", { length: 250 }),
    tg_id: varchar("tg_id", { length: 250 }),
    organization_id: uuid("organization_id"),
    attestation_pin_hash: varchar("attestation_pin_hash", { length: 255 }),
    department: varchar("department", { length: 50 }),
  },
  (table) => {
    return {
      UQ_0e2c0e1b3b0b0b0b0b0b0b0b0b0: uniqueIndex(
        "UQ_0e2c0e1b3b0b0b0b0b0b0b0b0b0"
      ).on(table.login),
      UQ_0e2c0e1b4b5b0b0b0b0b0b0b0b0: uniqueIndex(
        "UQ_0e2c0e1b4b5b0b0b0b0b0b0b0b0"
      ).on(table.email),
      UQ_a000cca60bcf04454e727699490: uniqueIndex(
        "UQ_a000cca60bcf04454e727699490"
      ).on(table.phone),
      fki_users_login: index("fki_users_login").on(table.login),
    };
  }
);

export const users_stores = pgTable("users_stores", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  user_id: uuid("user_id"),
  corporation_store_id: uuid("corporation_store_id"),
});

export const work_schedule_entries = pgTable(
  "work_schedule_entries",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    user_id: uuid("user_id").notNull(),
    work_schedule_id: uuid("work_schedule_id").notNull(),
    date_start: timestamp("date_start", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    date_finish: timestamp("date_finish", {
      withTimezone: true,
      mode: "string",
    }),
    duration: integer("duration").default(0).notNull(),
    ip_open: text("ip_open"),
    ip_close: text("ip_close"),
    lat_open: doublePrecision("lat_open").notNull(),
    lat_close: doublePrecision("lat_close"),
    lon_open: doublePrecision("lon_open").notNull(),
    lon_close: doublePrecision("lon_close"),
    current_status: work_schedule_entry_status("current_status")
      .default("open")
      .notNull(),
    late: boolean("late").default(false).notNull(),
    created_at: timestamp("created_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    created_by: uuid("created_by"),
    updated_by: uuid("updated_by"),
  },
  (table) => {
    return {
      fki_work_schedule_entries_current_status: index(
        "fki_work_schedule_entries_current_status"
      ).on(table.current_status),
      fki_work_schedule_entries_user_id: index(
        "fki_work_schedule_entries_user_id"
      ).on(table.user_id),
    };
  }
);

export const work_schedules = pgTable("work_schedules", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  name: text("name").notNull(), // название графика
  active: boolean("active").default(true).notNull(), // активен ли график
  organization_id: uuid("organization_id").notNull(), // id организации
  days: text("days").array(), // дни недели
  start_time: time("start_time", { withTimezone: true }).notNull(), // начало рабочего дня
  end_time: time("end_time", { withTimezone: true }).notNull(), // конец рабочего дня
  max_start_time: time("max_start_time", { withTimezone: true }).notNull(), // максимальное время начала работы
  bonus_price: integer("bonus_price").default(0).notNull(), // цена бонуса  
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  created_by: uuid("created_by"),
  updated_by: uuid("updated_by"),
});

export const writeoff = pgTable(
  "writeoff",
  {
    id: uuid("id").notNull(),
    dateIncoming: timestamp("dateincoming", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    // Колонка в БД так и называется с опечаткой — "documnentNumber"; переименование
    // потребовало бы миграции timescaledb-гипертаблицы. TS-свойство исправлено, чтобы
    // upsert в cron/iiko_sync.ts (ключ documentNumber) перестал молча отбрасываться.
    documentNumber: varchar("documnentNumber", { length: 255 }),
    status: varchar("status", { length: 255 }),
    conceptionId: uuid("conceptionId"),
    comment: varchar("comment", { length: 255 }),
    storeId: uuid("storeId"),
  },
  (table) => {
    return {
      PK_writeoff: primaryKey({ columns: [table.id, table.dateIncoming] }),
    };
  }
);

export const writeoff_items = pgTable(
  "writeoff_items",
  {
    id: uuid("id").defaultRandom().notNull(),
    productId: uuid("productId"),
    productSizeId: varchar("productSizeId", { length: 255 }),
    amountFactor: integer("amountFactor"),
    amount: numeric("amount", { precision: 10, scale: 4 }),
    measureUnitId: uuid("measureUnitId"),
    containerId: varchar("containerId", { length: 255 }),
    cost: integer("cost"),
    writeoff_id: uuid("writeoff_id"),
    writeoffincomingdate: timestamp("writeoffincomingdate", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
  },
  (table) => {
    return {
      PK_writeoff_items: primaryKey({
        columns: [table.id, table.writeoffincomingdate],
      }),
    };
  }
);

export const users_terminals = pgTable(
  "users_terminals",
  {
    user_id: uuid("user_id").notNull(),
    terminal_id: uuid("terminal_id").notNull(),
  },
  (table) => {
    return {
      PK_users_terminals_id: primaryKey({
        columns: [table.user_id, table.terminal_id],
        name: "PK_users_terminals_id",
      }),
    };
  }
);

export const users_work_schedules = pgTable(
  "users_work_schedules",
  {
    user_id: uuid("user_id").notNull(),
    work_schedule_id: uuid("work_schedule_id").notNull(),
  },
  (table) => {
    return {
      PK_users_work_schedules_id: primaryKey({
        columns: [table.user_id, table.work_schedule_id],
        name: "PK_users_work_schedules_id",
      }),
    };
  }
);

export const roles_permissions = pgTable(
  "roles_permissions",
  {
    role_id: uuid("role_id").notNull(),
    permission_id: uuid("permission_id").notNull(),
    created_by: uuid("created_by"),
    updated_by: uuid("updated_by"),
  },
  (table) => {
    return {
      PK_0cd11f0b35c4d348c6ebb9b36b7: primaryKey({
        columns: [table.role_id, table.permission_id],
        name: "PK_0cd11f0b35c4d348c6ebb9b36b7",
      }),
    };
  }
);

export const internal_transfer = pgTable(
  "internal_transfer",
  {
    id: uuid("id").defaultRandom().notNull(),
    dateIncoming: timestamp("dateIncoming", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    documentNumber: varchar("documentnumber", { length: 255 }),
    status: varchar("status", { length: 255 }),
    conceptionId: uuid("conceptionId"),
    storeFromId: uuid("storeFromId"),
    storeToId: uuid("storeToId"),
  },
  (table) => {
    return {
      internal_transfer_pkey: primaryKey({
        columns: [table.id, table.dateIncoming],
        name: "internal_transfer_pkey",
      }),
    };
  }
);

export const internal_transfer_items = pgTable(
  "internal_transfer_items",
  {
    id: uuid("id").defaultRandom().notNull(),
    productId: uuid("productId"),
    amount: numeric("amount", { precision: 10, scale: 4 }),
    measureUnitId: uuid("measureUnitId"),
    containerId: varchar("containerId", { length: 255 }),
    cost: integer("cost"),
    internal_transfer_id: uuid("internal_transfer_id"),
    num: varchar("num", { length: 255 }),
    internaltransferdate: timestamp("internaltransferdate", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
  },
  (table) => {
    return {
      internalTransferItems_pkey: primaryKey({
        columns: [table.id, table.internaltransferdate],
        name: "internalTransferItems_pkey",
      }),
    };
  }
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().notNull(),
    date: timestamp("date", { withTimezone: true, mode: "string" }).notNull(),
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
      reports_pkey: primaryKey({
        columns: [table.id, table.date],
        name: "reports_pkey",
      }),
    };
  }
);

export const reports_items = pgTable(
  "reports_items",
  {
    id: uuid("id").defaultRandom().notNull(),
    report_id: uuid("report_id").notNull(),
    label: varchar("label", { length: 255 }).notNull(),
    type: report_item_type("type").notNull(),
    amount: integer("amount").default(0),
    source: varchar("source", { length: 255 }).notNull(),
    report_date: timestamp("report_date", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      reports_items_pkey: primaryKey({
        columns: [table.id, table.report_date],
        name: "reports_items_pkey",
      }),
    };
  }
);

export const reports_logs = pgTable(
  "reports_logs",
  {
    id: uuid("id").defaultRandom().notNull(),
    reports_id: uuid("reports_id").notNull(),
    reports_item_id: uuid("reports_item_id").notNull(),
    before_json: text("before_json"),
    after_json: text("after_json"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    user_id: uuid("user_id").notNull(),
    before_text: text("before_text"),
    after_text: text("after_text"),
    report_date: timestamp("report_date", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
  },
  (table) => {
    return {
      reports_logs_pkey: primaryKey({
        columns: [table.id, table.report_date],
        name: "reports_logs_pkey",
      }),
    };
  }
);

export const product_groups = pgTable("product_groups", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  sort: integer("sort").default(0).notNull(),
  organization_id: uuid("organization_id").notNull(),
  show_inventory: boolean("show_inventory").default(true),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const product_group_items = pgTable("product_group_items", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  product_group_id: uuid("product_group_id").notNull(),
  product_id: uuid("product_id").notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const nomenclature_element_organization = pgTable(
  "nomenclature_element_organization",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    nomenclature_element_id: uuid("nomenclature_element_id").notNull(),
    organization_id: uuid("organization_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  }
);

export const vacancy = pgTable("vacancy", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  applicationNum: varchar("application_num", { length: 255 }).notNull(),
  organizationId: uuid("organization_id").references(() => organization.id),
  terminalId: uuid("terminal_id").references(() => terminals.id),
  position: uuid("position").references(() => positions.id),
  work_schedule_id: uuid("work_schedule_id").references(() => work_schedules.id),
  reason: varchar("reason", { length: 255 }).notNull(),
  openDate: timestamp("open_date", { withTimezone: true, mode: "string" }).notNull(),
  closingDate: timestamp("closing_date", { withTimezone: true, mode: "string" }),
  recruiter: uuid("recruiter").references(() => users.id),
  internshipDate: timestamp("internship_date", { withTimezone: true, mode: "string" }),
  termClosingDate: timestamp("term_closing_date", { withTimezone: true, mode: "string" }),
  comments: text("comments"),
  status: vacancyStatusEnumV2('status').default('open'),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
});


// Должность
export const positions = pgTable('positions', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  title: varchar('title', { length: 100 }).notNull(), // название должности
  description: text('description'), // описание должности
  requirements: text('requirements'), // требования
  salaryMin: integer('salary_min'), // минимальная зарплата
  salaryMax: integer('salary_max'), // максимальная зарплата
  terminalId: uuid('terminal_id').references(() => terminals.id), // филиал  
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// кондидаты
export const candidates = pgTable('candidates', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  vacancyId: uuid('vacancy_id').references(() => vacancy.id), // вакансия
  fullName: varchar('full_name', { length: 255 }).notNull(), // ФИО
  birthDate: timestamp('birth_date', { withTimezone: true, mode: "string" }), // дата рождения
  citizenship: varchar('citizenship', { length: 255 }), // гражданство
  residence: varchar('residence', { length: 255 }), // место поживания
  phoneNumber: varchar('phone_number', { length: 255 }).notNull(), // телефон
  email: varchar('email', { length: 255 }), // email
  passportNumber: varchar('passport_number', { length: 255 }), // номер паспорта
  passportSeries: varchar('passport_series', { length: 255 }), // серия паспорта
  passportIdDate: timestamp('passport_id_date', { withTimezone: true, mode: "string" }), // дата выдачи паспорта
  passportIdPlace: varchar('passport_id_place', { length: 255 }), // место выдачи паспорта
  source: varchar('source', { length: 255 }), // откуда узнали об вакансии
  familyStatus: varchar('family_status', { length: 255 }), // семейное положение
  children: integer('children'), // количество детей
  language: varchar('language', { length: 255 }), // язык
  strengthsShortage: varchar('strengths_shortage', { length: 255 }), // слабые стороны
  relatives: varchar('relatives', { length: 255 }), // родственники
  desiredSalary: integer('desired_salary'), // желаемая зарплата
  desiredSchedule: varchar('desired_schedule', { length: 255 }), // желаемый график работы
  purpose: varchar('purpose', { length: 255 }), // цель прихода на наше предприятие
  desiredPosition: varchar('desired_position', { length: 255 }), // желаемая должность
  resultStatus: interviewResultEnum("result_status").default('neutral'), // результат собеседования
  isFirstJob: boolean('is_first_job').default(false), // является ли это первым местом работы
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const education = pgTable('education', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  candidateId: uuid('candidate_id').references(() => candidates.id), // кондидат
  dateStart: timestamp('date_start', { withTimezone: true, mode: "string" }), // дата начала обучения
  dateEnd: timestamp('date_end', { withTimezone: true, mode: "string" }), // дата окончания обучения
  educationType: varchar('education_type', { length: 255 }), // тип образования
  university: varchar('university', { length: 255 }), // ВУЗ
  speciality: varchar('speciality', { length: 255 }), // специальность
});

export const last_work_place = pgTable('last_work_place', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  candidateId: uuid('candidate_id').references(() => candidates.id), // кондидат
  lastWorkPlace: varchar('last_work_place', { length: 255 }), // последнее место работы
  dismissalDate: timestamp('dismissal_date', { withTimezone: true, mode: "string" }), // дата увольнения
  employmentDate: timestamp('employment_date', { withTimezone: true, mode: "string" }), // дата приема на работу
  experience: varchar('experience', { length: 255 }), // опыт работы
  organizationName: varchar('organization_name', { length: 255 }), // наименование организации
  position: varchar('position', { length: 255 }), // должность
  addressOrg: varchar('address_org', { length: 255 }), // адресс организации
  dismissalReason: varchar('dismissal_reason', { length: 255 }), // причина увольнения
});

export const family_list = pgTable('family_list', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  candidateId: uuid('candidate_id').references(() => candidates.id), // кондидат
  familyListName: varchar('family_list_name', { length: 255 }), // ФИО родственников
  familyListBirthDate: timestamp('family_list_birth_date', { withTimezone: true, mode: "string" }), // дата рождения родственников
  familyListPhone: varchar('family_list_phone', { length: 255 }), // телефон родственников
  familyListRelation: varchar('family_list_relation', { length: 255 }), // родственные отношения
  familyListAddress: varchar('family_list_address', { length: 255 }), // адресс родственников
  familyJob: varchar('family_job', { length: 255 }), // место работы родственников
});

// собеседования
export const interviews = pgTable('interviews', {
  id: uuid('id').defaultRandom().primaryKey().notNull(),
  candidateId: uuid('candidate_id').references(() => candidates.id), // кондидат
  interviewerId: uuid('interviewer_id').references(() => users.id), // интервьюер
  interviewDate: timestamp('interview_date').notNull(), // дата интервью
  interviewResult: varchar('interview_result', { length: 255 }), // результат интервью
  status: interviewStatusEnum('status').default('scheduled'), // статус интервью
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const nomenclatureElementToOrganization = relations(
  nomenclature_element_organization,
  ({ one }) => ({
    nomenclatureElement: one(nomenclature_element, {
      fields: [nomenclature_element_organization.nomenclature_element_id],
      references: [nomenclature_element.id],
    }),
    organization: one(organization, {
      fields: [nomenclature_element_organization.organization_id],
      references: [organization.id],
    }),
  })
);

export const vacancyRelations = relations(vacancy, ({ one }) => ({
  creator: one(users, {
    fields: [vacancy.createdBy],
    references: [users.id],
  }),
  updater: one(users, {
    fields: [vacancy.updatedBy],
    references: [users.id],
  }),
  workSchedule: one(work_schedules, {
    fields: [vacancy.work_schedule_id],
    references: [work_schedules.id],
  }),
}));

export const orders = pgTable('orders', {
  id: uuid('id').notNull(),
  cashRegisterName: varchar('cash_register_name', { length: 255 }),
  cashRegisterNumber: numeric('cash_register_number'),
  openTime: timestamp('open_time', { mode: 'string' }),
  closeTime: timestamp('close_time', { mode: 'string' }),
  deliveryActualTime: timestamp('delivery_actual_time', { mode: 'string' }),
  deliveryBillTime: timestamp('delivery_bill_time', { mode: 'string' }),
  deliveryCloseTime: timestamp('delivery_close_time', { mode: 'string' }),
  deliveryCustomerPhone: varchar('delivery_customer_phone', { length: 255 }),
  deliveryEmail: varchar('delivery_email', { length: 255 }),
  deliveryId: varchar('delivery_id', { length: 255 }),
  isDelivery: varchar('is_delivery', { length: 255 }),
  deliveryNumber: varchar('delivery_number', { length: 255 }),
  deliveryPhone: varchar('delivery_phone', { length: 255 }),
  deliveryPrintTime: timestamp('delivery_print_time', { mode: 'string' }),
  deliverySendTime: timestamp('delivery_send_time', { mode: 'string' }),
  deliveryServiceType: varchar('delivery_service_type', { length: 255 }),
  deliverySourceKey: varchar('delivery_source_key', { length: 255 }),
  deliveryWayDuration: varchar('delivery_way_duration', { length: 255 }),
  conception: varchar('conception', { length: 255 }),
  dayOfWeekOpen: varchar('day_of_week_open', { length: 255 }),
  deletedWithWriteoff: varchar('deleted_with_writeoff', { length: 255 }),
  department: varchar('department', { length: 255 }),
  departmentId: varchar('department_id', { length: 255 }),
  discountPercent: numeric('discount_percent'),
  discountSum: numeric('discount_sum'),
  dishAmountInt: numeric('dish_amount_int'),
  dishDiscountSumInt: numeric('dish_discount_sum_int'),
  externalNumber: varchar('external_number', { length: 255 }),
  fiscalChequeNumber: numeric('fiscal_cheque_number'),
  hourClose: varchar('hour_close', { length: 255 }),
  hourOpen: varchar('hour_open', { length: 255 }),
  increasePercent: numeric('increase_percent'),
  jurName: varchar('jur_name', { length: 255 }),
  monthOpen: varchar('month_open', { length: 255 }),
  openDateTyped: timestamp('open_date_typed', { mode: 'string' }).notNull(),
  orderDeleted: varchar('order_deleted', { length: 255 }),
  orderDiscountType: varchar('order_discount_type', { length: 255 }),
  orderNum: numeric('order_num'),
  orderServiceType: varchar('order_service_type', { length: 255 }),
  orderType: varchar('order_type', { length: 255 }),
  orderTypeId: varchar('order_type_id', { length: 255 }),
  originName: varchar('origin_name', { length: 255 }),
  payTypesCombo: varchar('pay_types_combo', { length: 255 }),
  prechequeTime: timestamp('precheque_time', { mode: 'string' }),
  priceCategory: varchar('price_category', { length: 255 }),
  quarterOpen: varchar('quarter_open', { length: 255 }),
  restaurantSectionId: uuid('restaurant_section_id'),
  restaurantGroup: varchar('restaurant_group', { length: 255 }),
  restaurantGroupId: uuid('restaurant_group_id'),
  sessionNum: numeric('session_num'),
  storeId: uuid('store_id'),
  storeName: varchar('store_name', { length: 255 }),
  storeTo: varchar('store_to', { length: 255 }),
  tableNum: numeric('table_num'),
  uniqOrderIdId: uuid('uniq_order_id_id'),
  weekInMonthOpen: varchar('week_in_month_open', { length: 255 }),
  weekInYearOpen: varchar('week_in_year_open', { length: 255 }),
  yearOpen: varchar('year_open', { length: 255 }),
  storned: varchar('storned', { length: 255 }),
  dishType: varchar('dish_type', { length: 255 }),
}, (table) => {
  return {
    orderPK: primaryKey({ columns: [table.id, table.openDateTyped] }),
  };
});

export const orders_by_time = pgTable('orders_by_time', {
  id: uuid('id').notNull(),
  cashRegisterName: varchar('cash_register_name', { length: 255 }),
  cashRegisterNumber: numeric('cash_register_number'),
  openTime: timestamp('open_time', { mode: 'string' }).notNull(),
  closeTime: timestamp('close_time', { mode: 'string' }),
  deliveryActualTime: timestamp('delivery_actual_time', { mode: 'string' }),
  deliveryBillTime: timestamp('delivery_bill_time', { mode: 'string' }),
  deliveryCloseTime: timestamp('delivery_close_time', { mode: 'string' }),
  deliveryCustomerPhone: varchar('delivery_customer_phone', { length: 255 }),
  deliveryEmail: varchar('delivery_email', { length: 255 }),
  deliveryId: varchar('delivery_id', { length: 255 }),
  isDelivery: varchar('is_delivery', { length: 255 }),
  deliveryNumber: varchar('delivery_number', { length: 255 }),
  deliveryPhone: varchar('delivery_phone', { length: 255 }),
  deliveryPrintTime: timestamp('delivery_print_time', { mode: 'string' }),
  deliverySendTime: timestamp('delivery_send_time', { mode: 'string' }),
  deliveryServiceType: varchar('delivery_service_type', { length: 255 }),
  deliverySourceKey: varchar('delivery_source_key', { length: 255 }),
  deliveryWayDuration: varchar('delivery_way_duration', { length: 255 }),
  conception: varchar('conception', { length: 255 }),
  dayOfWeekOpen: varchar('day_of_week_open', { length: 255 }),
  deletedWithWriteoff: varchar('deleted_with_writeoff', { length: 255 }),
  department: varchar('department', { length: 255 }),
  departmentId: varchar('department_id', { length: 255 }),
  discountPercent: numeric('discount_percent'),
  discountSum: numeric('discount_sum'),
  dishAmountInt: numeric('dish_amount_int'),
  dishDiscountSumInt: numeric('dish_discount_sum_int'),
  externalNumber: varchar('external_number', { length: 255 }),
  fiscalChequeNumber: numeric('fiscal_cheque_number'),
  hourClose: varchar('hour_close', { length: 255 }),
  hourOpen: varchar('hour_open', { length: 255 }),
  increasePercent: numeric('increase_percent'),
  jurName: varchar('jur_name', { length: 255 }),
  monthOpen: varchar('month_open', { length: 255 }),
  openDateTyped: timestamp('open_date_typed', { mode: 'string' }).notNull(),
  orderDeleted: varchar('order_deleted', { length: 255 }),
  orderDiscountType: varchar('order_discount_type', { length: 255 }),
  orderNum: numeric('order_num'),
  orderServiceType: varchar('order_service_type', { length: 255 }),
  orderType: varchar('order_type', { length: 255 }),
  orderTypeId: varchar('order_type_id', { length: 255 }),
  originName: varchar('origin_name', { length: 255 }),
  payTypesCombo: varchar('pay_types_combo', { length: 255 }),
  prechequeTime: timestamp('precheque_time', { mode: 'string' }),
  priceCategory: varchar('price_category', { length: 255 }),
  quarterOpen: varchar('quarter_open', { length: 255 }),
  restaurantSectionId: uuid('restaurant_section_id'),
  restaurantGroup: varchar('restaurant_group', { length: 255 }),
  restaurantGroupId: uuid('restaurant_group_id'),
  sessionNum: numeric('session_num'),
  storeId: uuid('store_id'),
  storeName: varchar('store_name', { length: 255 }),
  storeTo: varchar('store_to', { length: 255 }),
  tableNum: numeric('table_num'),
  uniqOrderIdId: uuid('uniq_order_id_id'),
  weekInMonthOpen: varchar('week_in_month_open', { length: 255 }),
  weekInYearOpen: varchar('week_in_year_open', { length: 255 }),
  yearOpen: varchar('year_open', { length: 255 }),
  storned: varchar('storned', { length: 255 }),
  dishType: varchar('dish_type', { length: 255 }),
}, (table) => {
  return {
    orderByTimePK: primaryKey({ columns: [table.id, table.openTime] }),
  };
});

export const ordersHourlyAggregation = pgMaterializedView("orders_hourly_aggregation", {
  bucket: timestamp("bucket"),
  restaurantGroupId: integer("restaurant_group_id"),
  departmentId: integer("department_id"),
  orderCount: integer("order_count"),
  totalRevenue: decimal("total_revenue"),
}).existing();

export const revenueDailyAggregation = pgMaterializedView("revenue_daily_aggregation", {
  bucket: timestamp("bucket"),
  restaurantGroupId: integer("restaurant_group_id"),
  departmentId: integer("department_id"),
  orderCount: integer("order_count"),
  totalRevenue: decimal("total_revenue"),
}).existing();

export const revenueMonthlyAggregation = pgMaterializedView("revenue_monthly_aggregation", {
  bucket: timestamp("bucket"),
  restaurantGroupId: integer("restaurant_group_id"),
  departmentId: integer("department_id"),
  orderCount: integer("order_count"),
  totalRevenue: decimal("total_revenue"),
}).existing();

export const revenueWeeklyAggregation = pgMaterializedView("revenue_weekly_aggregation", {
  bucket: timestamp("bucket"),
  restaurantGroupId: integer("restaurant_group_id"),
  departmentId: integer("department_id"),
  orderCount: integer("order_count"),
  totalRevenue: decimal("total_revenue"),
}).existing();

export const order_items = pgTable('order_items', {
  id: uuid('id').notNull(),
  uniqOrderId: uuid('uniq_order_id').notNull(),
  dishId: uuid('dish_id'),
  dishName: varchar('dish_name', { length: 255 }),
  dishAmountInt: numeric('dish_amount_int'),
  dishDiscountSumInt: numeric('dish_discount_sum_int'),
  dishType: varchar('dish_type', { length: 255 }),
  orderType: varchar('order_type', { length: 255 }),
  orderTypeId: varchar('order_type_id', { length: 255 }),
  openDateTyped: timestamp('open_date_typed', { mode: 'string' }).notNull(),
  deliveryPhone: varchar('delivery_phone', { length: 255 }),
  restaurantGroup: varchar('restaurant_group', { length: 255 }),
  restaurantGroupId: uuid('restaurant_group_id'),
  department: varchar('department', { length: 255 }),
  departmentId: varchar('department_id', { length: 255 }),
}, (table) => [
  primaryKey({ columns: [table.id, table.uniqOrderId, table.openDateTyped] }),
]);

export const productDailyAggregation = pgMaterializedView("product_daily_aggregation", {
  bucket: timestamp("bucket"),
  restaurantGroupId: varchar("restaurant_group_id"),
  departmentId: varchar("department_id"),
  dishId: varchar("dish_id"),
  dishName: varchar("dish_name", { length: 255 }),
  dishDiscountSumInt: integer("dish_discount_sum_int"),
  totalCount: integer("total_count"),
}).existing();

export const productCookingTime = pgTable('product_cooking_time', {
  id: uuid('id').defaultRandom().notNull(),
  uniqOrderId: uuid('uniq_order_id').notNull(),
  restorauntGroup: varchar('restoraunt_group', { length: 255 }).notNull(),
  cookingPlace: varchar('cooking_place', { length: 255 }).notNull(),
  // orderType: varchar('order_type', { length: 255 }).notNull(),
  dishName: varchar('dish_name', { length: 255 }).notNull(),
  openTime: timestamp('open_time', { mode: 'string' }).notNull(),
  cookingFinishTime: timestamp('cooking_finish_time', { mode: 'string' }),
  dishAmountInt: integer('dish_amount_int').notNull(),
  guestWaitTimeAvg: integer('guest_wait_time_avg').notNull(),
  openDateTyped: timestamp('open_date_typed', { mode: 'string' }).notNull(),
  departmentId: varchar('department_id', { length: 255 }).notNull(),
  department: varchar('department', { length: 255 }).notNull(),
}, (table) => [
  primaryKey({ columns: [table.id, table.uniqOrderId, table.openDateTyped] }),
]);

export const basketAdditionalSales = pgTable('basket_additional_sales', {
  id: uuid('id').defaultRandom().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  terminalId: uuid('terminal_id').notNull(),
  quantity: integer('quantity').notNull(),
  price: numeric('price').notNull(),
  operator: varchar('operator', { length: 255 }),
  source: varchar('source', { length: 255 }).notNull(),
  organizationId: varchar('organization_id', { length: 255 }).notNull(),
  orderId: varchar('order_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.id, table.createdAt] }),
  index('idx_basket_additional_sales_source').on(table.source),
  index('idx_basket_additional_sales_operator').on(table.operator),
]);



export const hangingOrders = pgTable(
    "managers_hanging_orders",
    {
        id: uuid("id").primaryKey().defaultRandom(),
        brand: varchar("brand", { length: 50 }).notNull(), // 'chopar' or 'les_ailes'
        date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD format
        terminalId: text("terminal_id"),
        orderId: text("order_id"),
        externalOrderNumber: text("external_order_number"),
        timestamp: timestamp("timestamp"),
        conception: text("conception"),
        orderType: text("order_type"),
        paymentType: text("payment_type"),
        receiptNumber: text("receipt_number"),
        orderStatus: text("order_status"),
        comments: text("comments"),
        problem: text("problem"),
        phoneNumber: text("phone_number"),
        amount: decimal("amount", { precision: 10, scale: 2 }),
        composition: text("composition"),
        status: text("status"), // Manual tracking status
        comment: text("comment"), // Manual comment
        createdAt: timestamp("created_at").defaultNow(),
        updatedAt: timestamp("updated_at").defaultNow(),
    },
    (table) => ({
        brandDateIdx: index(`managers_brand_date_idx`).on(table.brand, table.date),
        orderIdIdx: index(`managers_order_id_idx`).on(table.orderId),
        timestampIdx: index(`managers_timestamp_idx`).on(table.timestamp),
    })
);

export const externalPartners = pgTable("external_partners", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 255 }),
  password: varchar("password", { length: 255 }),
  is_active: boolean("is_active").default(true),
  is_deleted: boolean("is_deleted").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const playground_tickets = pgTable(
  "playground_tickets",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    terminal_id: uuid("terminal_id").notNull(),
    organization_id: uuid("organization_id").notNull(),
    order_number: varchar("order_number", { length: 255 }).notNull(),
    order_amount: integer("order_amount").notNull(),
    children_count: integer("children_count").notNull(),
    is_used: boolean("is_used").default(false).notNull(),
    used_at: timestamp("used_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      terminal_id_idx: index("idx_playground_tickets_terminal_id").on(table.terminal_id),
      created_at_idx: index("idx_playground_tickets_created_at").on(table.created_at),
      organization_id_idx: index("idx_playground_tickets_organization_id").on(
        table.organization_id
      ),
    };
  }
);

export const sales_plans = pgTable(
  "sales_plans",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    terminal_id: uuid("terminal_id").notNull(),
    organization_id: uuid("organization_id").notNull(),
    year: integer("year").notNull(),
    month: integer("month").notNull(),
    created_by: uuid("created_by"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      terminal_month_unique: uniqueIndex("sales_plans_terminal_year_month_key").on(
        table.terminal_id,
        table.year,
        table.month
      ),
      terminal_id_idx: index("idx_sales_plans_terminal_id").on(table.terminal_id),
      organization_id_idx: index("idx_sales_plans_organization_id").on(table.organization_id),
    };
  }
);

export const sales_plan_items = pgTable(
  "sales_plan_items",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    plan_id: uuid("plan_id").notNull(),
    product_id: uuid("product_id").notNull(),
    product_name: varchar("product_name", { length: 255 }).notNull(),
    planned_qty: integer("planned_qty").notNull(),
  },
  (table) => {
    return {
      plan_id_idx: index("idx_sales_plan_items_plan_id").on(table.plan_id),
    };
  }
);

export const sales_plan_stats = pgTable(
  "sales_plan_stats",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    plan_id: uuid("plan_id").notNull(),
    plan_item_id: uuid("plan_item_id").notNull(),
    terminal_id: uuid("terminal_id").notNull(),
    date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD format
    sold_qty: integer("sold_qty").notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      item_terminal_date_unique: uniqueIndex("sales_plan_stats_item_terminal_date_key").on(
        table.plan_item_id,
        table.terminal_id,
        table.date
      ),
      terminal_date_idx: index("idx_sales_plan_stats_terminal_date").on(
        table.terminal_id,
        table.date
      ),
      plan_id_idx: index("idx_sales_plan_stats_plan_id").on(table.plan_id),
    };
  }
);

export const asrabox_stock_history = pgTable(
  "asrabox_stock_history",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    terminal_id: uuid("terminal_id").notNull(),
    iiko_id: text("iiko_id").notNull(),
    composition_id: text("composition_id").notNull(),
    quantity: integer("quantity").notNull(),
    set_by: uuid("set_by").notNull(),
    set_at: timestamp("set_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    laravel_response: jsonb("laravel_response"),
  },
  (table) => {
    return {
      terminal_composition_set_at_idx: index(
        "idx_asrabox_stock_history_terminal_composition_set_at"
      ).on(table.terminal_id, table.composition_id, table.set_at),
    };
  }
);

export const ordersBySource = pgTable('orders_by_source', {
  date: date('date').notNull(),
  terminalId: varchar('terminal_id', { length: 255 }).notNull(),
  organizationId: varchar('organization_id', { length: 255 }).notNull(),
  source: varchar('source', { length: 255 }).notNull(),
  orderCount: integer('order_count').notNull().default(0),
  totalRevenue: numeric('total_revenue').notNull().default('0'),
}, (table) => [
  primaryKey({ columns: [table.date, table.terminalId, table.organizationId, table.source] }),
  index('idx_orders_by_source_date').on(table.date),
]);
// Справочник должностей персонала филиалов.
//
// Не путать с `positions` по соседству: та таблица описывает ВАКАНСИЮ (зарплатная
// вилка, привязка к филиалу, требования) и живёт в найме. Здесь — сама роль в
// смене: повар, кассир, менеджер. Одна строка справочника может стоять за сотней
// вакансий и за сотней людей.
//
// Стажёрские роли лежат тут же отдельными строками, а не выводятся из флага.
// Причина в данных: «Стажер повар» и «Стажер кассир» — это то, как должность
// пишет сам бизнес, и оба экрана (карта сети, состав филиалов) уже считают
// «Стажёр-повар» отдельной ролью. Флаг is_trainee при этом остаётся: он говорит,
// что роль временная, а trainee_of_code — кем человек станет, когда стажировка
// закончится. Перевод стажёра в штат = смена staff_role_id на trainee_of_code.
export const staff_roles = pgTable(
  "staff_roles",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    code: varchar("code", { length: 50 }).notNull(),
    name_ru: varchar("name_ru", { length: 150 }).notNull(),
    name_uz: varchar("name_uz", { length: 150 }).notNull(),
    /** kitchen | front | management | other — те же четыре группы, что у parsePosition. */
    group_key: varchar("group_key", { length: 20 }).notNull(),
    is_trainee: boolean("is_trainee").default(false).notNull(),
    /** code роли, на которую учится стажёр; null у нестажёрских ролей. */
    trainee_of_code: varchar("trainee_of_code", { length: 50 }),
    /**
     * Поисковые слова роли: то, чем работа называется в жизни, а не в канонe.
     * Канонизация строк должностей убрала «(салатчица+мойка)» из 46 записей —
     * данных это не потеряло, но кадровик, который ищет «салатчица», перестал
     * находить кого бы то ни было. Сюда HR дописывает такие слова сам.
     *
     * null и пустой массив означают одно и то же — синонимов нет.
     */
    synonyms: text("synonyms").array(),
    sort: integer("sort").default(0).notNull(),
    active: boolean("active").default(true).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("staff_roles_code_key").on(table.code)]
);

export const employees = pgTable("employees", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  first_name: varchar("first_name", { length: 100 }).notNull(),
  last_name: varchar("last_name", { length: 100 }).notNull(),
  /**
   * Свободная строка должности — остаётся ведущей для всех, кто её уже читает
   * (фильтр аттестации по ilike, паспорт стажёра, колонка в админке). После
   * появления полей ниже она перестаёт быть источником структуры и становится
   * её отпечатком: собирается по одному шаблону «Роль[ N разряд][ смена]».
   */
  position: varchar("position", { length: 150 }),
  /** Роль из справочника. null — строка ещё не разобрана (см. parsePosition). */
  staff_role_id: uuid("staff_role_id").references(() => staff_roles.id),
  /** Разряд 1..3; null — в должности разряда нет, и это нормально. */
  grade: integer("grade"),
  /** "day" | "night"; null — смена не указана (у охраны и няни её нет вовсе). */
  shift: varchar("shift", { length: 10 }),
  /** Дублирует staff_roles.is_trainee, чтобы считать стажёров без join. */
  is_trainee: boolean("is_trainee"),
  terminal_id: uuid("terminal_id").notNull(),
  pin_hash: text("pin_hash"),
  external_id: varchar("external_id", { length: 100 }),
  active: boolean("active").default(true).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const attestation_tests = pgTable("attestation_tests", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  passing_score: integer("passing_score").default(80).notNull(),
  time_limit_minutes: integer("time_limit_minutes"),
  questions_per_attempt: integer("questions_per_attempt"),
  shuffle_questions: boolean("shuffle_questions").default(true).notNull(),
  shuffle_options: boolean("shuffle_options").default(true).notNull(),
  valid_months: integer("valid_months"),
  active: boolean("active").default(true).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const attestation_test_questions = pgTable("attestation_test_questions", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  test_id: uuid("test_id").notNull(),
  text: text("text").notNull(),
  type: attestation_question_type("type").default("single").notNull(),
  explanation: text("explanation"),
  sort: integer("sort").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
});

export const attestation_test_question_options = pgTable(
  "attestation_test_question_options",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    question_id: uuid("question_id").notNull(),
    text: text("text").notNull(),
    is_correct: boolean("is_correct").default(false).notNull(),
    sort: integer("sort").default(0).notNull(),
  }
);

export const attestation_test_attempts = pgTable("attestation_test_attempts", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  test_id: uuid("test_id").notNull(),
  employee_id: uuid("employee_id").notNull(),
  terminal_id: uuid("terminal_id").notNull(),
  launched_by_user_id: uuid("launched_by_user_id"),
  started_at: timestamp("started_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  submitted_at: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
  status: attestation_attempt_status("status").default("in_progress").notNull(),
  score: integer("score"),
  passed: boolean("passed"),
  expires_at: timestamp("expires_at", { withTimezone: true, mode: "string" }),
  question_ids: jsonb("question_ids").notNull(),
  source: varchar("source", { length: 10 }).default("kiosk").notNull(), // kiosk | miniapp
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const attestation_test_attempt_answers = pgTable(
  "attestation_test_attempt_answers",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    attempt_id: uuid("attempt_id").notNull(),
    question_id: uuid("question_id").notNull(),
    question_text: text("question_text").notNull(),
    selected_option_ids: jsonb("selected_option_ids").notNull(),
    is_correct: boolean("is_correct").default(false).notNull(),
  }
);

export const medical_exam_result = pgEnum("medical_exam_result", [
  "fit",
  "fit_restricted",
  "unfit",
]);

export const medical_exam_schedules = pgTable("medical_exam_schedules", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  employee_id: uuid("employee_id").notNull().unique(),
  start_date: date("start_date").notNull(),
  interval_months: integer("interval_months").default(6).notNull(),
  active: boolean("active").default(true).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const medical_exams = pgTable("medical_exams", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  schedule_id: uuid("schedule_id").notNull(),
  employee_id: uuid("employee_id").notNull(),
  planned_due_date: date("planned_due_date").notNull(),
  completed_date: date("completed_date"),
  result: medical_exam_result("result"),
  notes: text("notes"),
  recorded_by: uuid("recorded_by"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

// ==== B2B credit (spec docs/superpowers/specs/2026-07-30-b2b-credit-design.md) ====
export const credit_company_status = pgEnum("credit_company_status", [
  "active", "suspended", "pending_verification",
]);
export const credit_brand = pgEnum("credit_brand", ["chopar", "les"]);
export const credit_hold_state = pgEnum("credit_hold_state", [
  "held", "captured", "voided", "expired",
]);
export const credit_entry_type = pgEnum("credit_entry_type", [
  // 'amend' = a change to a still-held hold's amount (entry amount = the delta).
  // Distinct from 'adjustment' (a manual change to posted debt) because
  // reconciliation sums adjustment into expected_posted and must not see amends.
  "authorize", "capture", "void", "refund", "payment", "adjustment", "amend",
]);
export const credit_document_type = pgEnum("credit_document_type", [
  "contract", "inn_cert", "guarantee_letter", "other",
]);

export const credit_companies = pgTable("credit_companies", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  name: text("name").notNull(),
  inn: text("inn"),
  phone: text("phone"),
  status: credit_company_status("status").default("pending_verification").notNull(),
  limit_total: bigint("limit_total", { mode: "number" }).default(0).notNull(),
  limit_daily: bigint("limit_daily", { mode: "number" }).default(0).notNull(),
  limit_monthly: bigint("limit_monthly", { mode: "number" }).default(0).notNull(),
  overdue: boolean("overdue").default(false).notNull(),
  verified_by: uuid("verified_by"),
  verified_at: timestamp("verified_at", { precision: 5, withTimezone: true }),
  created_at: timestamp("created_at", { precision: 5, withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { precision: 5, withTimezone: true }).defaultNow().notNull(),
});

export const credit_company_documents = pgTable("credit_company_documents", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  company_id: uuid("company_id").notNull().references(() => credit_companies.id),
  type: credit_document_type("type").default("other").notNull(),
  file_path: text("file_path").notNull(),
  doc_number: text("doc_number"),
  doc_date: timestamp("doc_date", { precision: 5, withTimezone: true }),
  uploaded_by: uuid("uploaded_by"),
  created_at: timestamp("created_at", { precision: 5, withTimezone: true }).defaultNow().notNull(),
});

export const credit_company_phones = pgTable("credit_company_phones", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  company_id: uuid("company_id").notNull().references(() => credit_companies.id),
  phone: text("phone").notNull(),
  employee_name: text("employee_name"),
  active: boolean("active").default(true).notNull(),
  created_at: timestamp("created_at", { precision: 5, withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  credit_phone_uniq: uniqueIndex("credit_phone_uniq").on(t.phone),
}));

export const credit_accounts = pgTable("credit_accounts", {
  company_id: uuid("company_id").primaryKey().notNull().references(() => credit_companies.id),
  posted: bigint("posted", { mode: "number" }).default(0).notNull(),
  reserved: bigint("reserved", { mode: "number" }).default(0).notNull(),
  version: integer("version").default(0).notNull(),
  updated_at: timestamp("updated_at", { precision: 5, withTimezone: true }).defaultNow().notNull(),
});

export const credit_periods = pgTable("credit_periods", {
  company_id: uuid("company_id").notNull().references(() => credit_companies.id),
  period_key: text("period_key").notNull(), // 'YYYY-MM-DD' day | 'YYYY-MM' month
  spent: bigint("spent", { mode: "number" }).default(0).notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.company_id, t.period_key] }),
}));

export const credit_holds = pgTable("credit_holds", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  company_id: uuid("company_id").notNull().references(() => credit_companies.id),
  brand: credit_brand("brand").notNull(),
  order_id: text("order_id").notNull(),
  order_number: text("order_number"),
  amount: bigint("amount", { mode: "number" }).notNull(),
  state: credit_hold_state("state").default("held").notNull(),
  period_day_key: text("period_day_key").notNull(),
  period_month_key: text("period_month_key").notNull(),
  expires_at: timestamp("expires_at", { precision: 5, withTimezone: true }).notNull(),
  created_at: timestamp("created_at", { precision: 5, withTimezone: true }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { precision: 5, withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  credit_hold_order_uniq: uniqueIndex("credit_hold_order_uniq").on(t.brand, t.order_id),
}));

export const credit_entries = pgTable("credit_entries", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  company_id: uuid("company_id").notNull().references(() => credit_companies.id),
  hold_id: uuid("hold_id"),
  brand: credit_brand("brand"),
  order_id: text("order_id"),
  order_number: text("order_number"),
  entry_type: credit_entry_type("entry_type").notNull(),
  amount: bigint("amount", { mode: "number" }).notNull(), // signed
  balance_after: bigint("balance_after", { mode: "number" }).notNull(), // posted+reserved after op
  period_day_key: text("period_day_key"),
  period_month_key: text("period_month_key"),
  meta: jsonb("meta"),
  created_by: uuid("created_by"),
  created_at: timestamp("created_at", { precision: 5, withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  credit_entries_company_created: index("credit_entries_company_created").on(t.company_id, t.created_at.desc()),
  // One entry per (order, operation) — the idempotency gate behind every
  // "replay = ok, no second debit" path in service.ts.
  //
  // PARTIAL, and written as an explicit whitelist rather than `<> 'amend'`: an
  // order may legally be amended many times, so amend entries must not be gated.
  // The whitelist form (instead of excluding the new value) is what lets this
  // index be created in the SAME transaction that adds 'amend' to the enum —
  // postgres refuses to use a newly added enum value in the transaction that
  // created it.
  //
  // TWO THINGS MUST BE KEPT IN SYNC WITH THIS PREDICATE:
  // 1. Any FUTURE credit_entry_type value is a conscious decision — add it here
  //    to keep it under the uniqueness gate, or deliberately leave it out. Doing
  //    nothing means it silently escapes the gate, i.e. that operation loses its
  //    "replay = ok, no second debit" guarantee with no error anywhere.
  // 2. service.ts's ENTRY_OP_CONFLICT_TARGET, which repeats this predicate
  //    character-for-character. Postgres will not infer a PARTIAL index as an
  //    ON CONFLICT arbiter unless the statement restates its predicate; a
  //    mismatch raises 42P10 at plan time and every capture/void/refund fails.
  credit_entries_op_uniq: uniqueIndex("credit_entries_op_uniq").on(t.brand, t.order_id, t.entry_type)
    .where(sql`entry_type IN ('authorize','capture','void','refund','payment','adjustment')`),
}));

export const credit_payments = pgTable("credit_payments", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  company_id: uuid("company_id").notNull().references(() => credit_companies.id),
  amount: bigint("amount", { mode: "number" }).notNull(),
  doc_number: text("doc_number"),
  doc_date: timestamp("doc_date", { precision: 5, withTimezone: true }),
  note: text("note"),
  created_by: uuid("created_by"),
  created_at: timestamp("created_at", { precision: 5, withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  // The payment document is the only natural key a bank transfer has: this is
  // what makes applyPayment replay-safe against a double-submitted admin form.
  // Partial because doc_number stays nullable (legacy/manual entries) — and a
  // NULL doc_number therefore has NO replay protection, which is why the admin
  // UI must always send one.
  credit_payment_doc_uniq: uniqueIndex("credit_payment_doc_uniq").on(t.company_id, t.doc_number)
    .where(sql`doc_number IS NOT NULL`),
}));

// ===================== TRAINEE PASSPORT =====================
export const passport_module_status = pgEnum("passport_module_status", ["draft", "review", "published"]);
export const passport_verification_type = pgEnum("passport_verification_type", ["quiz", "observation", "quiz_observation", "quiz_observation_photo", "dual"]);
export const passport_enrollment_status = pgEnum("passport_enrollment_status", ["active", "completed", "failed", "paused"]);
export const passport_signoff_action = pgEnum("passport_signoff_action", ["material_opened", "quiz_passed", "quiz_failed", "observed", "observation_declined", "recheck_passed", "recheck_failed", "level_set", "level_rolled_back", "stamp_issued"]);
export const passport_stamp_type = pgEnum("passport_stamp_type", ["module_cert", "universal_chopar", "universal_les", "probation_passed"]);

export const passport_programs = pgTable("passport_programs", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  position: varchar("position", { length: 100 }).notNull(),
  title_ru: varchar("title_ru", { length: 255 }).notNull(),
  title_uz: varchar("title_uz", { length: 255 }).notNull(),
  active: boolean("active").default(true).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const passport_modules = pgTable("passport_modules", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  title_ru: varchar("title_ru", { length: 255 }).notNull(),
  title_uz: varchar("title_uz", { length: 255 }).default("").notNull(),
  brand: varchar("brand", { length: 20 }), // null | 'chopar' | 'les'
  owner_department: varchar("owner_department", { length: 50 }).notNull(),
  status: passport_module_status("status").default("draft").notNull(),
  // Orthogonal to status: retires a module from the trainee feed and from the
  // default curriculum listing WITHOUT touching history. The soft alternative
  // to unpublish, which is refused once any trainee has progress on it.
  active: boolean("active").default(true).notNull(),
  version: integer("version").default(1).notNull(),
  exam_test_id: uuid("exam_test_id"), // -> attestation_tests
  parent_module_id: uuid("parent_module_id"), // root of the version chain (new-version fork)
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const passport_program_modules = pgTable("passport_program_modules", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  program_id: uuid("program_id").notNull().references(() => passport_programs.id),
  module_id: uuid("module_id").notNull().references(() => passport_modules.id),
  sort: integer("sort").default(0).notNull(),
  required: boolean("required").default(true).notNull(),
  deadline_days: integer("deadline_days"),
}, (t) => [uniqueIndex("UQ_passport_prog_mod").on(t.program_id, t.module_id)]);

export const passport_topics = pgTable("passport_topics", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  module_id: uuid("module_id").notNull().references(() => passport_modules.id),
  sort: integer("sort").default(0).notNull(),
  title_ru: varchar("title_ru", { length: 255 }).notNull(),
  title_uz: varchar("title_uz", { length: 255 }).default("").notNull(),
  step_ru: text("step_ru").default("").notNull(),
  step_uz: text("step_uz").default("").notNull(),
  key_point_ru: text("key_point_ru").default("").notNull(),
  key_point_uz: text("key_point_uz").default("").notNull(),
  reason_ru: text("reason_ru").default("").notNull(),
  reason_uz: text("reason_uz").default("").notNull(),
  video_id: uuid("video_id"), // -> passport_media
  verification_type: passport_verification_type("verification_type").default("quiz_observation").notNull(),
  quiz_test_id: uuid("quiz_test_id"), // -> attestation_tests
  observation_checklist: jsonb("observation_checklist"), // {items:[{ru,uz}], questions:[{ru,uz}]}
  active: boolean("active").default(true).notNull(),
}, (t) => [
  // Every read of a topic list is "the ACTIVE topics of these modules": the
  // trainee /me feed and the HR progress matrix both do
  // module_id IN (...) AND active. Without this the table had only its PK and
  // both did a seq scan. Partial on `active` because a retired topic is never
  // in the answer.
  index("IX_passport_topics_module").on(t.module_id).where(sql`active`),
]);

export const passport_enrollments = pgTable("passport_enrollments", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  employee_id: uuid("employee_id").notNull().references(() => employees.id),
  program_id: uuid("program_id").notNull().references(() => passport_programs.id),
  terminal_id: uuid("terminal_id").notNull(),
  status: passport_enrollment_status("status").default("active").notNull(),
  started_at: timestamp("started_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  probation_deadline: timestamp("probation_deadline", { withTimezone: true, mode: "string" }),
  completed_at: timestamp("completed_at", { withTimezone: true, mode: "string" }),
  created_by_user_id: uuid("created_by_user_id").notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const passport_invites = pgTable("passport_invites", {
  id: uuid("id").defaultRandom().primaryKey().notNull(), // сам токен инвайта
  enrollment_id: uuid("enrollment_id").notNull().references(() => passport_enrollments.id),
  created_by_user_id: uuid("created_by_user_id").notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  used_at: timestamp("used_at", { withTimezone: true, mode: "string" }),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const passport_tg_bindings = pgTable("passport_tg_bindings", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  telegram_id: bigint("telegram_id", { mode: "number" }).notNull(),
  employee_id: uuid("employee_id").references(() => employees.id), // стажёр
  user_id: uuid("user_id"), // наставник/аудитор -> users
  first_name: varchar("first_name", { length: 255 }).default("").notNull(),
  lang: varchar("lang", { length: 2 }).default("ru").notNull(), // ru | uz
  banned: boolean("banned").default(false).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (t) => [uniqueIndex("UQ_passport_tg").on(t.telegram_id)]);

export const passport_topic_progress = pgTable("passport_topic_progress", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  enrollment_id: uuid("enrollment_id").notNull().references(() => passport_enrollments.id),
  topic_id: uuid("topic_id").notNull().references(() => passport_topics.id),
  level: integer("level").default(0).notNull(), // 0..4
  quiz_attempt_id: uuid("quiz_attempt_id"),
  observed_by_user_id: uuid("observed_by_user_id"),
  observed_at: timestamp("observed_at", { withTimezone: true, mode: "string" }),
  observation_answers: jsonb("observation_answers"),
  photo_path: varchar("photo_path", { length: 500 }),
  recheck_due_at: timestamp("recheck_due_at", { withTimezone: true, mode: "string" }),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (t) => [uniqueIndex("UQ_passport_progress").on(t.enrollment_id, t.topic_id)]);

export const passport_signoffs = pgTable("passport_signoffs", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  enrollment_id: uuid("enrollment_id").notNull().references(() => passport_enrollments.id),
  topic_id: uuid("topic_id"),
  module_id: uuid("module_id"),
  action: passport_signoff_action("action").notNull(),
  actor_user_id: uuid("actor_user_id"),
  actor_employee_id: uuid("actor_employee_id"),
  terminal_id: uuid("terminal_id"),
  ip: varchar("ip", { length: 64 }),
  meta: jsonb("meta"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
}, (t) => [index("IX_passport_signoffs_enr").on(t.enrollment_id, t.created_at)]);

export const passport_stamps = pgTable("passport_stamps", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  enrollment_id: uuid("enrollment_id").notNull().references(() => passport_enrollments.id),
  employee_id: uuid("employee_id").notNull(),
  type: passport_stamp_type("type").notNull(),
  module_id: uuid("module_id"),
  issued_by_user_id: uuid("issued_by_user_id"), // null = автомат
  manual_comment: text("manual_comment"),
  valid_until: timestamp("valid_until", { withTimezone: true, mode: "string" }),
  issued_at: timestamp("issued_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const passport_qr_tokens = pgTable("passport_qr_tokens", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  enrollment_id: uuid("enrollment_id").notNull(),
  topic_id: uuid("topic_id").notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  used_at: timestamp("used_at", { withTimezone: true, mode: "string" }),
  used_by_user_id: uuid("used_by_user_id"),
  trainee_ip: varchar("trainee_ip", { length: 64 }),
});

export const passport_rechecks = pgTable("passport_rechecks", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  topic_progress_id: uuid("topic_progress_id").notNull().references(() => passport_topic_progress.id),
  assigned_to_user_id: uuid("assigned_to_user_id").notNull(),
  origin: varchar("origin", { length: 10 }).default("random").notNull(), // random | manual
  due_at: timestamp("due_at", { withTimezone: true, mode: "string" }).notNull(),
  result: varchar("result", { length: 10 }), // null | passed | failed
  resolved_at: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const passport_flags = pgTable("passport_flags", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  type: varchar("type", { length: 50 }).notNull(),
  subject_user_id: uuid("subject_user_id"),
  enrollment_id: uuid("enrollment_id"),
  meta: jsonb("meta"),
  resolved: boolean("resolved").default(false).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const passport_media = pgTable("passport_media", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  title: varchar("title", { length: 255 }).default("").notNull(),
  file_path: varchar("file_path", { length: 500 }).notNull(),
  status: varchar("status", { length: 20 }).default("ready").notNull(),
  transcode_error: text("transcode_error"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Stop-list history (fed by Laravel ProcessActualizeStopList webhooks, 2026-08)
// stoplist_events is a TimescaleDB hypertable (see drizzle/timescale_stoplist.sql —
// create_hypertable + continuous aggregate are applied out-of-band, same as the
// other hypertables in timescale_scripts.sql).
// ---------------------------------------------------------------------------

export const stoplist_events = pgTable(
  "stoplist_events",
  {
    id: uuid("id").defaultRandom().notNull(),
    event_at: timestamp("event_at", { withTimezone: true, mode: "string" }).notNull(),
    brand: text("brand").notNull(), // 'chopar' | 'les'
    terminal_id: integer("terminal_id").notNull(),
    terminal_name: text("terminal_name"),
    product_id: integer("product_id").notNull(),
    product_name: text("product_name"),
    action: text("action").notNull(), // 'stop' | 'release'
    balance: doublePrecision("balance"),
    date_add: timestamp("date_add", { withTimezone: true, mode: "string" }),
    // iiko terminalGroup uuid — joins credentials(model='terminals', type='iiko_id')
    // to reach the managers terminals a manager is bound to.
    terminal_iiko_id: uuid("terminal_iiko_id"),
    recorded_at: timestamp("recorded_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      brand_term_prod_event_idx: index(
        "idx_stoplist_events_brand_term_prod_event_at"
      ).on(table.brand, table.terminal_id, table.product_id, table.event_at),
      event_at_idx: index("idx_stoplist_events_event_at").on(table.event_at),
    };
  }
);

// One row per continuous stop period; ended_at IS NULL = currently stopped.
// A partial unique index (uq_stoplist_intervals_open, created in
// timescale_stoplist.sql) guarantees a single open interval per position.
export const stoplist_intervals = pgTable(
  "stoplist_intervals",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    brand: text("brand").notNull(),
    terminal_id: integer("terminal_id").notNull(),
    terminal_name: text("terminal_name"),
    product_id: integer("product_id").notNull(),
    product_name: text("product_name"),
    started_at: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull(),
    ended_at: timestamp("ended_at", { withTimezone: true, mode: "string" }),
    last_balance: doublePrecision("last_balance"),
    // iiko terminalGroup uuid — joins credentials(model='terminals', type='iiko_id').
    terminal_iiko_id: uuid("terminal_iiko_id"),
  },
  (table) => {
    return {
      open_lookup_idx: index("idx_stoplist_intervals_open_lookup").on(
        table.brand,
        table.terminal_id,
        table.product_id,
        table.ended_at
      ),
      started_at_idx: index("idx_stoplist_intervals_started_at").on(table.started_at),
      iiko_ended_idx: index("idx_stoplist_intervals_iiko_ended").on(
        table.terminal_iiko_id,
        table.ended_at
      ),
    };
  }
);

// ---- Кассовые смены iiko (виджет «Кассовые смены» на дашборде) -------------
// Наполняет cron/cash_shifts_sync раз в сутки из resto v2/cashshifts/list.
// id — id смены в iiko. terminal_id = null, если точка продаж не привязана к
// терминалу через corporation/groups → credentials(model='terminals', type='iiko_id').
export const cash_shifts = pgTable(
  "cash_shifts",
  {
    id: uuid("id").primaryKey().notNull(),
    terminal_id: uuid("terminal_id"),
    iiko_group_id: uuid("iiko_group_id"),
    iiko_group_name: text("iiko_group_name"),
    point_of_sale_id: uuid("point_of_sale_id").notNull(),
    cash_reg_number: integer("cash_reg_number").notNull(),
    cash_register_name: text("cash_register_name"),
    session_number: integer("session_number").notNull(),
    open_at: timestamp("open_at", { withTimezone: true, mode: "string" }).notNull(),
    close_at: timestamp("close_at", { withTimezone: true, mode: "string" }),
    business_date: date("business_date", { mode: "string" }).notNull(),
    status: text("status").notNull(),
    responsible_user_id: uuid("responsible_user_id"),
    responsible_user_name: text("responsible_user_name"),
    manager_id: uuid("manager_id"),
    manager_name: text("manager_name"),
    pay_orders: numeric("pay_orders", { precision: 18, scale: 2 }).default("0").notNull(),
    sales_cash: numeric("sales_cash", { precision: 18, scale: 2 }).default("0").notNull(),
    sales_card: numeric("sales_card", { precision: 18, scale: 2 }).default("0").notNull(),
    sales_credit: numeric("sales_credit", { precision: 18, scale: 2 }).default("0").notNull(),
    pay_in: numeric("pay_in", { precision: 18, scale: 2 }).default("0").notNull(),
    pay_out: numeric("pay_out", { precision: 18, scale: 2 }).default("0").notNull(),
    cash_diff: numeric("cash_diff", { precision: 18, scale: 2 }).default("0").notNull(),
    synced_at: timestamp("synced_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      business_date_idx: index("idx_cash_shifts_business_date").on(table.business_date),
      terminal_date_idx: index("idx_cash_shifts_terminal_date").on(
        table.terminal_id,
        table.business_date
      ),
    };
  }
);

// Кассиры смены из OLAP SALES (SessionID × Cashier.Id). Пересобирается целиком
// для каждой синкнутой смены.
export const cash_shift_cashiers = pgTable(
  "cash_shift_cashiers",
  {
    shift_id: uuid("shift_id")
      .notNull()
      .references(() => cash_shifts.id, { onDelete: "cascade" }),
    cashier_id: uuid("cashier_id").notNull(),
    cashier_name: text("cashier_name").notNull(),
    cashier_code: text("cashier_code"),
    orders_count: integer("orders_count").notNull(),
    revenue: numeric("revenue", { precision: 18, scale: 2 }).notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.shift_id, table.cashier_id] }),
    };
  }
);

export const ticket_status = pgEnum("ticket_status", [
  "new",
  "in_progress",
  "done",
  "closed",
  "cancelled",
]);

export const ticket_priority = pgEnum("ticket_priority", ["normal", "urgent"]);

export const ticket_executor_kind = pgEnum("ticket_executor_kind", ["external", "staff"]);

export const ticket_attachment_phase = pgEnum("ticket_attachment_phase", ["problem", "result"]);

export const ticket_payment_status = pgEnum("ticket_payment_status", [
  "pending",
  "approved",
  "rejected",
]);

export const ticket_actor_kind = pgEnum("ticket_actor_kind", [
  "manager",
  "executor",
  "office",
  "system",
]);

export const ticket_event_type = pgEnum("ticket_event_type", [
  "created",
  "assigned",
  "comment",
  "done_submitted",
  "reopened",
  "closed",
  "cancelled",
  "payment_approved",
  "payment_rejected",
]);

export const ticket_notification_kind = pgEnum("ticket_notification_kind", ["send", "edit"]);

export const ticket_notification_status = pgEnum("ticket_notification_status", [
  "pending",
  "sending",
  "sent",
  "failed",
]);

export const ticket_contractors = pgTable("ticket_contractors", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 50 }),
  note: text("note"),
  is_active: boolean("is_active").default(true).notNull(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const ticket_types = pgTable(
  "ticket_types",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    code: varchar("code", { length: 50 }).notNull(),
    number_prefix: varchar("number_prefix", { length: 5 }).notNull(),
    name_ru: varchar("name_ru", { length: 255 }).notNull(),
    name_uz: varchar("name_uz", { length: 255 }).notNull(),
    icon: varchar("icon", { length: 50 }),
    executor_kind: ticket_executor_kind("executor_kind").notNull(),
    contractor_id: uuid("contractor_id").references(() => ticket_contractors.id),
    fields_schema: jsonb("fields_schema").default([]).notNull(),
    requires_cost: boolean("requires_cost").default(true).notNull(),
    active: boolean("active").default(true).notNull(),
    sort: integer("sort").default(0).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    code_idx: uniqueIndex("idx_ticket_types_code").on(table.code),
  })
);

export const ticket_executors = pgTable(
  "ticket_executors",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    kind: ticket_executor_kind("kind").notNull(),
    contractor_id: uuid("contractor_id").references(() => ticket_contractors.id),
    user_id: uuid("user_id"),
    full_name: varchar("full_name", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 50 }),
    tg_user_id: bigint("tg_user_id", { mode: "number" }),
    lang: varchar("lang", { length: 10 }).default("ru").notNull(),
    invite_code: uuid("invite_code").defaultRandom().notNull(),
    invite_used_at: timestamp("invite_used_at", { withTimezone: true, mode: "string" }),
    is_active: boolean("is_active").default(true).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    tg_user_id_idx: uniqueIndex("idx_ticket_executors_tg_user_id").on(table.tg_user_id),
    invite_code_idx: uniqueIndex("idx_ticket_executors_invite_code").on(table.invite_code),
    contractor_idx: index("idx_ticket_executors_contractor_id").on(table.contractor_id),
    kind_target_check: check(
      "ticket_executors_kind_target",
      sql`(contractor_id IS NOT NULL) <> (user_id IS NOT NULL)`
    ),
  })
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    seq: serial("seq").notNull(),
    type_id: uuid("type_id").references(() => ticket_types.id).notNull(),
    terminal_id: uuid("terminal_id").notNull(),
    organization_id: uuid("organization_id").notNull(),
    status: ticket_status("status").default("new").notNull(),
    priority: ticket_priority("priority").default("normal").notNull(),
    details: jsonb("details").default({}).notNull(),
    description: text("description"),
    created_by: uuid("created_by").notNull(),
    assigned_executor_id: uuid("assigned_executor_id").references(() => ticket_executors.id),
    assigned_at: timestamp("assigned_at", { withTimezone: true, mode: "string" }),
    done_at: timestamp("done_at", { withTimezone: true, mode: "string" }),
    closed_at: timestamp("closed_at", { withTimezone: true, mode: "string" }),
    cancelled_at: timestamp("cancelled_at", { withTimezone: true, mode: "string" }),
    closed_by: uuid("closed_by"),
    cancelled_by: uuid("cancelled_by"),
    reopen_count: integer("reopen_count").default(0).notNull(),
    work_total_amount: numeric("work_total_amount", { precision: 14, scale: 2 }),
    payment_status: ticket_payment_status("payment_status").default("pending").notNull(),
    payment_approved_by: uuid("payment_approved_by"),
    payment_approved_at: timestamp("payment_approved_at", { withTimezone: true, mode: "string" }),
    payment_comment: text("payment_comment"),
    manager_seen_at: timestamp("manager_seen_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    terminal_idx: index("idx_tickets_terminal_id").on(table.terminal_id),
    status_idx: index("idx_tickets_status").on(table.status),
    type_idx: index("idx_tickets_type_id").on(table.type_id),
    created_at_idx: index("idx_tickets_created_at").on(table.created_at),
    executor_idx: index("idx_tickets_assigned_executor_id").on(table.assigned_executor_id),
    payment_idx: index("idx_tickets_payment_pending")
      .on(table.payment_status)
      .where(sql`status = 'closed'`),
  })
);

export const ticket_attachments = pgTable(
  "ticket_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    ticket_id: uuid("ticket_id").references(() => tickets.id).notNull(),
    phase: ticket_attachment_phase("phase").notNull(),
    file_path: text("file_path").notNull(),
    mime: varchar("mime", { length: 100 }).notNull(),
    size_bytes: integer("size_bytes").notNull(),
    uploaded_by_kind: ticket_actor_kind("uploaded_by_kind").notNull(),
    uploaded_by_user_id: uuid("uploaded_by_user_id"),
    uploaded_by_executor_id: uuid("uploaded_by_executor_id").references(() => ticket_executors.id),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    ticket_idx: index("idx_ticket_attachments_ticket_id").on(table.ticket_id),
  })
);

export const ticket_comments = pgTable(
  "ticket_comments",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    ticket_id: uuid("ticket_id").references(() => tickets.id).notNull(),
    author_kind: ticket_actor_kind("author_kind").notNull(),
    author_user_id: uuid("author_user_id"),
    author_executor_id: uuid("author_executor_id").references(() => ticket_executors.id),
    body: text("body").notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    ticket_idx: index("idx_ticket_comments_ticket_id").on(table.ticket_id),
  })
);

export const ticket_work_items = pgTable(
  "ticket_work_items",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    ticket_id: uuid("ticket_id").references(() => tickets.id).notNull(),
    position: integer("position").notNull(),
    title: text("title").notNull(),
    qty: numeric("qty", { precision: 10, scale: 2 }).default("1").notNull(),
    unit: varchar("unit", { length: 20 }),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    ticket_idx: index("idx_ticket_work_items_ticket_id").on(table.ticket_id),
  })
);

export const ticket_events = pgTable(
  "ticket_events",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    ticket_id: uuid("ticket_id").references(() => tickets.id).notNull(),
    type: ticket_event_type("type").notNull(),
    actor_kind: ticket_actor_kind("actor_kind").notNull(),
    actor_user_id: uuid("actor_user_id"),
    actor_executor_id: uuid("actor_executor_id").references(() => ticket_executors.id),
    payload: jsonb("payload").default({}).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    ticket_idx: index("idx_ticket_events_ticket_id").on(table.ticket_id),
  })
);

export const ticket_notifications = pgTable(
  "ticket_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    event_id: uuid("event_id").references(() => ticket_events.id).notNull(),
    channel: varchar("channel", { length: 20 }).default("telegram").notNull(),
    recipient_executor_id: uuid("recipient_executor_id").references(() => ticket_executors.id),
    recipient_chat_id: bigint("recipient_chat_id", { mode: "number" }).notNull(),
    kind: ticket_notification_kind("kind").default("send").notNull(),
    target_message_id: bigint("target_message_id", { mode: "number" }),
    status: ticket_notification_status("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    last_error: text("last_error"),
    tg_message_id: bigint("tg_message_id", { mode: "number" }),
    sent_at: timestamp("sent_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (table) => ({
    dedupe_idx: uniqueIndex("idx_ticket_notifications_dedupe").on(
      table.event_id,
      table.recipient_chat_id,
      table.kind
    ),
    pending_idx: index("idx_ticket_notifications_status").on(table.status, table.created_at),
  })
);

// ── Инвентаризации (spec 2026-10-02-inventory-counts-design.md) ──
// Внешних ключей на users/corporation_store/nomenclature_* нет намеренно:
// тестовая база пустая, а данные iiko синкаются отдельно.

export const inventory_templates = pgTable("inventory_templates", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  organization_id: uuid("organization_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  active: boolean("active").default(true).notNull(),
  sort: integer("sort").default(0).notNull(),
  created_by: uuid("created_by"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});

export const inventory_template_items = pgTable(
  "inventory_template_items",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    template_id: uuid("template_id")
      .notNull()
      .references(() => inventory_templates.id, { onDelete: "cascade" }),
    product_id: uuid("product_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => ({
    template_product_uq: uniqueIndex("inventory_template_items_template_product_uq").on(t.template_id, t.product_id),
  })
);

export const inventory_counts = pgTable(
  "inventory_counts",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    store_id: uuid("store_id").notNull(),
    // null у складов без организации (31 из 94 в проде, включая новые филиалы).
    organization_id: uuid("organization_id"),
    template_id: uuid("template_id")
      .notNull()
      .references(() => inventory_templates.id),
    template_name: varchar("template_name", { length: 255 }).notNull(),
    period: date("period", { mode: "string" }).notNull(),
    status: varchar("status", { length: 32 }).default("draft").notNull(),
    // Снимок: строки построены как шаблон ∩ товары филиала из exord (§13 спеки).
    exord_filtered: boolean("exord_filtered").default(false).notNull(),
    created_by: uuid("created_by").notNull(),
    submitted_by: uuid("submitted_by"),
    submitted_at: timestamp("submitted_at", { withTimezone: true, mode: "string" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => ({
    store_period_template_uq: uniqueIndex("inventory_counts_store_period_template_uq")
      .on(t.store_id, t.period, t.template_id)
      .where(sql`status <> 'cancelled'`),
    store_period_idx: index("inventory_counts_store_period_idx").on(t.store_id, t.period),
  })
);

export const inventory_count_lines = pgTable(
  "inventory_count_lines",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    count_id: uuid("count_id")
      .notNull()
      .references(() => inventory_counts.id, { onDelete: "cascade" }),
    product_id: uuid("product_id").notNull(),
    product_name: varchar("product_name", { length: 255 }).notNull(),
    unit_id: uuid("unit_id"),
    unit_name: varchar("unit_name", { length: 255 }),
    group_id: uuid("group_id"),
    group_name: varchar("group_name", { length: 512 }).notNull(),
    source: varchar("source", { length: 16 }).notNull(),
    added_by: uuid("added_by"),
    skipped: boolean("skipped").default(false).notNull(),
    skipped_by: uuid("skipped_by"),
    fact_qty: numeric("fact_qty", { precision: 14, scale: 4 }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => ({
    count_product_uq: uniqueIndex("inventory_count_lines_count_product_uq").on(t.count_id, t.product_id),
  })
);

export const inventory_count_entries = pgTable(
  "inventory_count_entries",
  {
    // id генерирует устройство — это ключ идемпотентности синхронизации.
    id: uuid("id").primaryKey().notNull(),
    count_id: uuid("count_id")
      .notNull()
      .references(() => inventory_counts.id, { onDelete: "cascade" }),
    line_id: uuid("line_id")
      .notNull()
      .references(() => inventory_count_lines.id, { onDelete: "cascade" }),
    qty: numeric("qty", { precision: 14, scale: 4 }).notNull(),
    created_by: uuid("created_by").notNull(),
    client_created_at: timestamp("client_created_at", { withTimezone: true, mode: "string" }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    deleted_at: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
    deleted_by: uuid("deleted_by"),
  },
  (t) => ({
    count_idx: index("inventory_count_entries_count_idx").on(t.count_id),
    line_idx: index("inventory_count_entries_line_idx").on(t.line_id),
    qty_check: check("inventory_count_entries_qty_check", sql`qty >= 0`),
  })
);

export const inventory_count_events = pgTable(
  "inventory_count_events",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    count_id: uuid("count_id")
      .notNull()
      .references(() => inventory_counts.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 32 }).notNull(),
    user_id: uuid("user_id").notNull(),
    payload: jsonb("payload"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
  },
  (t) => ({
    count_idx: index("inventory_count_events_count_idx").on(t.count_id),
  })
);

// exord → managers: which products each branch (terminal) orders.
// Replaced wholesale by cron/product_links_sync.ts; spec:
// docs/superpowers/specs/2026-10-03-product-links-sync-design.md
export const terminal_product_links = pgTable("terminal_product_links", {
  terminal_id: uuid("terminal_id").primaryKey().notNull(),
  product_ids: uuid("product_ids").array().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

export const product_links_meta = pgTable("product_links_meta", {
  id: integer("id").primaryKey().notNull().default(1),
  version: text("version").notNull(),
  generated_at: timestamp("generated_at", { withTimezone: true, mode: "string" }),
  terminals_count: integer("terminals_count").notNull(),
  links_count: integer("links_count").notNull(),
  synced_at: timestamp("synced_at", { withTimezone: true, mode: "string" })
    .defaultNow()
    .notNull(),
});

// Склад iiko → филиал (terminals.id), выведено из продаж (orders.store_id +
// restaurant_group_id) суточным cron/store_terminal_sync.ts. Без внешних ключей,
// как остальные таблицы инвентаризации. Spec: inventory-counts-design.md §13.
export const store_terminal_links = pgTable("store_terminal_links", {
  store_id: uuid("store_id").primaryKey().notNull(),
  terminal_id: uuid("terminal_id").notNull(),
  orders_90d: integer("orders_90d").notNull(),
  last_order_at: timestamp("last_order_at", { withTimezone: true, mode: "string" }),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
});
