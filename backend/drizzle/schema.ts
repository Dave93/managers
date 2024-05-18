import {
  pgTable,
  uniqueIndex,
  foreignKey,
  pgEnum,
  uuid,
  varchar,
  boolean,
  timestamp,
  text,
  doublePrecision,
  index,
  integer,
  time,
  primaryKey,
  numeric,
  decimal,
} from "drizzle-orm/pg-core";
import { name, relations, sql } from "drizzle-orm";

export const user_status = pgEnum("user_status", [
  "inactive",
  "blocked",
  "active",
]);
export const organization_system_type = pgEnum("organization_system_type", [
  "jowi",
  "r_keeper",
  "iiko",
]);
export const work_schedule_entry_status = pgEnum("work_schedule_entry_status", [
  "closed",
  "open",
]);
export const organization_payment_types = pgEnum("organization_payment_types", [
  "client",
  "card",
  "cash",
]);
export const report_status = pgEnum("report_status", [
  "cancelled",
  "comfirmed",
  "checking",
  "sent",
]);
export const report_item_type = pgEnum("report_item_type", [
  "outcome",
  "income",
]);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: varchar("name", { length: 50 }).notNull(),
    code: varchar("code", { length: 50 }),
    active: boolean("active").default(true).notNull(),
    created_at: timestamp("created_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    created_by: uuid("created_by").references(() => users.id, {
      onUpdate: "cascade",
    }),
    updated_by: uuid("updated_by").references(() => users.id, {
      onUpdate: "cascade",
    }),
  },
  (table) => {
    return {
      UQ_648e3f5447f725579d7d4ffdfb7: uniqueIndex(
        "UQ_648e3f5447f725579d7d4ffdfb7"
      ).on(table.name),
      UQ_0e2c0e1b4b0b0b0b0b0b0b0b0b0: uniqueIndex(
        "UQ_0e2c0e1b4b0b0b0b0b0b0b0b0b0"
      ).on(table.code),
    };
  }
);

export const organization = pgTable("organization", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  name: text("name").notNull(),
  active: boolean("active").default(true).notNull(),
  phone: text("phone"),
  description: text("description"),
  icon_url: text("icon_url"),
  created_at: timestamp("created_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
  created_by: uuid("created_by").references(() => users.id, {
    onUpdate: "cascade",
  }),
  updated_by: uuid("updated_by").references(() => users.id, {
    onUpdate: "cascade",
  }),
  code: text("code"),
});

export const terminals = pgTable("terminals", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  name: text("name").notNull(),
  active: boolean("active").default(true).notNull(),
  phone: text("phone"),
  address: text("address"),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  organization_id: uuid("organization_id")
    .notNull()
    .references(() => organization.id, { onUpdate: "cascade" }),
  manager_name: text("manager_name"),
  created_at: timestamp("created_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
});

export const api_tokens = pgTable(
  "api_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    active: boolean("active").default(false).notNull(),
    token: text("token").notNull(),
    organization_id: uuid("organization_id")
      .notNull()
      .references(() => organization.id, { onUpdate: "cascade" }),
    created_at: timestamp("created_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    created_by: uuid("created_by").references(() => users.id, {
      onUpdate: "cascade",
    }),
    updated_by: uuid("updated_by").references(() => users.id, {
      onUpdate: "cascade",
    }),
  },
  (table) => {
    return {
      id_key: uniqueIndex("api_tokens_id_key").on(table.id),
      token_key: uniqueIndex("api_tokens_token_key").on(table.token),
    };
  }
);

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
    birth_date: timestamp("birth_date", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    }),
    is_online: boolean("is_online").default(false).notNull(),
    fcm_token: varchar("fcm_token", { length: 250 }),
    doc_files: text("doc_files").array(),
    app_version: varchar("app_version", { length: 100 }),
    created_at: timestamp("created_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    api_token: varchar("api_token", { length: 250 }),
    tg_id: varchar("tg_id", { length: 250 }),
  },
  (table) => {
    return {
      UQ_a000cca60bcf04454e727699490: uniqueIndex(
        "UQ_a000cca60bcf04454e727699490"
      ).on(table.phone),
      UQ_0e2c0e1b4b5b0b0b0b0b0b0b0b0: uniqueIndex(
        "UQ_0e2c0e1b4b5b0b0b0b0b0b0b0b0"
      ).on(table.email),
      UQ_0e2c0e1b3b0b0b0b0b0b0b0b0b0: uniqueIndex(
        "UQ_0e2c0e1b3b0b0b0b0b0b0b0b0b0"
      ).on(table.login),
      fki_users_login: index("fki_users_login").on(table.login),
    };
  }
);

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
  user_agent: text("user_agent").notNull(),
  device_name: text("device_name").notNull(),
  created_at: timestamp("created_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
});

export const work_schedules = pgTable("work_schedules", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  name: text("name").notNull(),
  active: boolean("active").default(true).notNull(),
  organization_id: uuid("organization_id")
    .notNull()
    .references(() => organization.id, { onUpdate: "cascade" }),
  days: text("days").array(),
  start_time: time("start_time", {
    precision: 5,
    withTimezone: true,
  }).notNull(),
  end_time: time("end_time", { precision: 5, withTimezone: true }).notNull(),
  max_start_time: time("max_start_time", {
    precision: 5,
    withTimezone: true,
  }).notNull(),
  bonus_price: integer("bonus_price").default(0).notNull(),
  created_at: timestamp("created_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
  created_by: uuid("created_by").references(() => users.id, {
    onUpdate: "cascade",
  }),
  updated_by: uuid("updated_by").references(() => users.id, {
    onUpdate: "cascade",
  }),
});

export const work_schedule_entries = pgTable(
  "work_schedule_entries",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onUpdate: "cascade" }),
    work_schedule_id: uuid("work_schedule_id")
      .notNull()
      .references(() => work_schedules.id, { onUpdate: "cascade" }),
    date_start: timestamp("date_start", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    }).notNull(),
    date_finish: timestamp("date_finish", {
      precision: 5,
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
    created_at: timestamp("created_at", { precision: 5, mode: "string" })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { precision: 5, mode: "string" })
      .defaultNow()
      .notNull(),
    created_by: uuid("created_by").references(() => users.id, {
      onUpdate: "cascade",
    }),
    updated_by: uuid("updated_by").references(() => users.id, {
      onUpdate: "cascade",
    }),
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

export const credentials = pgTable("credentials", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  key: text("key").notNull(),
  model: text("model").notNull(),
  type: text("type").notNull(),
  created_at: timestamp("created_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
  created_by: uuid("created_by").references(() => users.id, {
    onUpdate: "cascade",
  }),
  updated_by: uuid("updated_by").references(() => users.id, {
    onUpdate: "cascade",
  }),
  model_id: text("model_id").notNull(),
});

export const settings = pgTable(
  "settings",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    is_secure: boolean("is_secure").default(false).notNull(),
    created_at: timestamp("created_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      key_key: uniqueIndex("settings_key_key").on(table.key),
    };
  }
);

export const timesheet = pgTable("timesheet", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  user_id: uuid("user_id")
    .notNull()
    .references(() => users.id, { onUpdate: "cascade" }),
  is_late: boolean("is_late").default(false).notNull(),
  date: timestamp("date", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  }).notNull(),
  created_at: timestamp("created_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
});

export const scheduled_reports = pgTable("scheduled_reports", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  name: text("name").notNull(),
  code: text("code").notNull(),
  cron: text("cron").notNull(),
  created_at: timestamp("created_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
});

export const report_groups = pgTable(
  "report_groups",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    created_at: timestamp("created_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    parent_id: uuid("parent_id"),
  },
  (table) => {
    return {
      FK_parent_id_report_groups: foreignKey({
        columns: [table.parent_id],
        foreignColumns: [table.id],
        name: "FK_parent_id_report_groups",
      }).onUpdate("cascade"),
    };
  }
);

export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    slug: varchar("slug", { length: 160 }).notNull(),
    description: varchar("description", { length: 60 }).notNull(),
    active: boolean("active").default(true).notNull(),
    created_at: timestamp("created_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    created_by: uuid("created_by").references(() => users.id, {
      onUpdate: "cascade",
    }),
    updated_by: uuid("updated_by").references(() => users.id, {
      onUpdate: "cascade",
    }),
  },
  (table) => {
    return {
      UQ_d090ad82a0e97ce764c06c7b312: uniqueIndex(
        "UQ_d090ad82a0e97ce764c06c7b312"
      ).on(table.slug),
    };
  }
);

export const scheduled_reports_subscription = pgTable(
  "scheduled_reports_subscription",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    report_id: uuid("report_id")
      .notNull()
      .references(() => scheduled_reports.id, { onUpdate: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onUpdate: "cascade" }),
    created_at: timestamp("created_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  }
);

export const reports_status = pgTable("reports_status", {
  id: uuid("id").defaultRandom().primaryKey().notNull(),
  code: varchar("code", { length: 255 }).notNull(),
  color: varchar("color", { length: 255 }).notNull(),
  created_at: timestamp("created_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
  updated_at: timestamp("updated_at", {
    precision: 5,
    withTimezone: true,
    mode: "string",
  })
    .defaultNow()
    .notNull(),
  label: varchar("label", { length: 255 }).notNull(),
});

export const users_terminals = pgTable(
  "users_terminals",
  {
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onUpdate: "cascade" }),
    terminal_id: uuid("terminal_id")
      .notNull()
      .references(() => terminals.id, { onUpdate: "cascade" }),
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
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onUpdate: "cascade" }),
    work_schedule_id: uuid("work_schedule_id")
      .notNull()
      .references(() => work_schedules.id, { onUpdate: "cascade" }),
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

export const users_permissions = pgTable(
  "users_permissions",
  {
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onUpdate: "cascade" }),
    permission_id: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onUpdate: "cascade" }),
    created_by: uuid("created_by").references(() => users.id, {
      onUpdate: "cascade",
    }),
    updated_by: uuid("updated_by").references(() => users.id, {
      onUpdate: "cascade",
    }),
  },
  (table) => {
    return {
      PK_7f3736984cd8546a1e418005561: primaryKey({
        columns: [table.user_id, table.permission_id],
        name: "PK_7f3736984cd8546a1e418005561",
      }),
    };
  }
);

export const roles_permissions = pgTable(
  "roles_permissions",
  {
    role_id: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onUpdate: "cascade" }),
    permission_id: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onUpdate: "cascade" }),
    created_by: uuid("created_by").references(() => users.id, {
      onUpdate: "cascade",
    }),
    updated_by: uuid("updated_by").references(() => users.id, {
      onUpdate: "cascade",
    }),
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

export const users_roles = pgTable(
  "users_roles",
  {
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onUpdate: "cascade" }),
    role_id: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onUpdate: "cascade" }),
    created_by: uuid("created_by").references(() => users.id, {
      onUpdate: "cascade",
    }),
    updated_by: uuid("updated_by").references(() => users.id, {
      onUpdate: "cascade",
    }),
  },
  (table) => {
    return {
      PK_c525e9373d63035b9919e578a9c: primaryKey({
        columns: [table.user_id, table.role_id],
        name: "PK_c525e9373d63035b9919e578a9c",
      }),
    };
  }
);

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

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().notNull(),
    date: timestamp("date", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    }).notNull(),
    status_id: uuid("status_id")
      .notNull()
      .references(() => reports_status.id, { onUpdate: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onUpdate: "cascade" }),
    terminal_id: uuid("terminal_id")
      .notNull()
      .references(() => terminals.id, { onUpdate: "cascade" }),
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
    amount: decimal("amount", { precision: 10, scale: 4 }),
    source: varchar("source", { length: 255 }).notNull(),
    group_id: uuid("group_id").references(() => report_groups.id, {
      onUpdate: "cascade",
    }),
    report_date: timestamp("report_date", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    }).notNull(),
    created_at: timestamp("created_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => {
    return {
      FK_reports_id: foreignKey({
        columns: [table.report_id, table.report_date],
        foreignColumns: [reports.id, reports.date],
        name: "FK_reports_id",
      }).onUpdate("cascade"),
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
    created_at: timestamp("created_at", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onUpdate: "cascade" }),
    before_text: text("before_text"),
    after_text: text("after_text"),
    report_date: timestamp("report_date", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    }).notNull(),
  },
  (table) => {
    return {
      FK_reports_logs_reports_id: foreignKey({
        columns: [table.reports_id, table.report_date],
        foreignColumns: [reports.id, reports.date],
        name: "FK_reports_logs_reports_id",
      }).onUpdate("cascade"),
      FK_reports_logs_reports_item_id: foreignKey({
        columns: [table.reports_item_id, table.report_date],
        foreignColumns: [reports_items.id, reports_items.report_date],
        name: "FK_reports_logs_reports_item_id",
      }).onUpdate("cascade"),
      reports_logs_pkey: primaryKey({
        columns: [table.id, table.report_date],
        name: "reports_logs_pkey",
      }),
    };
  }
);

export const tax_category = pgTable(
  "tax_category",
  {
    id: uuid("id").defaultRandom().notNull(),
    deleted: boolean("deleted").default(false),
    name: varchar("name", { length: 255 }),
    code: varchar("code", { length: 255 }),
  },
  (table) => {
    return {
      tax_category_pkey: primaryKey({
        columns: [table.id],
        name: "tax_category_pkey",
      }),
    };
  }
);

export const payment_type = pgTable(
  "payment_type",
  {
    id: uuid("id").defaultRandom().notNull(),
    deleted: boolean("deleted").default(false),
    name: varchar("name", { length: 255 }),
    code: varchar("code", { length: 255 }),
  },
  (table) => {
    return {
      paymentType_pkey: primaryKey({
        columns: [table.id],
        name: "paymentType_pkey",
      }),
    };
  }
);

export const order_type = pgTable(
  "order_type",
  {
    id: uuid("id").defaultRandom().notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 255 }),
  },
  (table) => {
    return {
      orderType_pkey: primaryKey({
        columns: [table.id],
        name: "orderType_pkey",
      }),
    };
  }
);

export const measure_unit = pgTable(
  "measure_unit",
  {
    id: uuid("id").defaultRandom().notNull(),
    deleted: boolean("deleted").default(false),
    name: varchar("name", { length: 255 }),
    code: varchar("code", { length: 255 }),
  },
  (table) => {
    return {
      measureUnit_pkey: primaryKey({
        columns: [table.id],
        name: "measureUnit_pkey",
      }),
    };
  }
);

export const discount_type = pgTable(
  "discount_type",
  {
    id: uuid("id").defaultRandom().notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    name: varchar("name", { length: 255 }),
    code: varchar("code", { length: 255 }),
  },
  (table) => {
    return {
      discountType_pkey: primaryKey({
        columns: [table.id],
        name: "discountType_pkey",
      }),
    };
  }
);

export const conception = pgTable(
  "conception",
  {
    id: uuid("id").defaultRandom().notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    name: varchar("name", { length: 255 }),
    code: varchar("code", { length: 255 }),
  },
  (table) => {
    return {
      conception_pkey: primaryKey({
        columns: [table.id],
        name: "conception_pkey",
      }),
    };
  }
);

export const accounting_category = pgTable(
  "accounting_category",
  {
    id: uuid("id").defaultRandom().notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 255 }).notNull(),
  },
  (table) => {
    return {
      accounting_category_pkey: primaryKey({
        columns: [table.id],
        name: "accounting_category_pkey",
      }),
    };
  }
);

export const nomenclature_group = pgTable(
  "nomenclature_group",
  {
    id: uuid("id").defaultRandom().notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    tax_category_id: uuid("tax_category_id").references(
      () => tax_category.id,
      {}
    ),
    category_id: uuid("category_id").references(
      () => nomenclature_category.id,
      {}
    ),
    accounting_category_id: uuid("accounting_category_id").references(
      () => accounting_category.id,
      {}
    ),
    parent_id: uuid("parent_id").defaultRandom().notNull(),
  },
  (table) => {
    return {
      nomenclature_group_pkey: primaryKey({
        columns: [table.id],
        name: "nomenclature_group_pkey",
      }),
    };
  }
);

export const nomenclature_category = pgTable(
  "nomenclature_category",
  {
    id: uuid("id").defaultRandom().notNull(),
    deleted: boolean("deleted").default(false),
    name: varchar("name", { length: 255 }),
    code: varchar("code", { length: 255 }),
  },
  (table) => {
    return {
      nomenclature_category_pkey: primaryKey({
        columns: [table.id],
        name: "nomenclature_category_pkey",
      }),
    };
  }
);

export const nomenclature_element = pgTable(
  "nomenclature_element",
  {
    id: uuid("id").defaultRandom().notNull(),
    deleted: boolean("deleted").default(false),
    name: varchar("name", { length: 255 }),
    description: varchar("code", { length: 255 }),
    num: varchar("num", { length: 255 }),
    tax_category_id: uuid("tax_category_id").references(
      () => tax_category.id,
      {}
    ),
    category_id: uuid("category_id").references(
      () => nomenclature_category.id,
      {}
    ),
    accounting_category_id: uuid("accounting_category_id").references(
      () => accounting_category.id,
      {}
    ),
    mainUnit: uuid("mainUnit").defaultRandom(),
    type: varchar("type", { length: 255 }),
    unitWeight: decimal("unitWeight", { precision: 10, scale: 4 }),
    unitCapacity: decimal("unitCapacity", { precision: 10, scale: 4 }),
  },
  (table) => {
    return {
      nomenclature_element_pkey: primaryKey({
        columns: [table.id],
        name: "nomenclature_element_pkey",
      }),
    };
  }
);

export const nomenclature_element_group = pgTable(
  "nomenclature_element_group",
  {
    id: uuid("id").defaultRandom().notNull(),
    deleted: boolean("deleted").default(false).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    code: varchar("code", { length: 255 }).notNull(),
    nomenclature_group_id: uuid("nomenclature_group_id").references(
      () => nomenclature_group.id,
      {}
    ),
  },
  (table) => {
    return {
      nomenclature_element_group_pkey: primaryKey({
        columns: [table.id],
        name: "nomenclature_element_group_pkey",
      }),
    };
  }
);

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").notNull(),
    incomingDocumentNumber: varchar("incomingDocumentNumber", { length: 255 }),
    incomingDate: timestamp("incomingDate", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    }),
    useDefaultDocumentTime: boolean("useDefaultDocumentTime").default(false),
    dueDate: timestamp("dueDate", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    }),
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
      incomingInvoice_pkey: primaryKey({
        columns: [table.id, table.incomingDate],
        name: "incomingInvoice_pkey",
      }),
    };
  }
);

export const invoice_items = pgTable(
  "invoice_items",
  {
    id: uuid("id").defaultRandom().notNull(),
    productId: uuid("productId"),
    isAdditionalExpense: boolean("isAdditionalExpense").default(false),
    actualAmount: decimal("actualAmount", { precision: 10, scale: 4 }),
    price: decimal("price", { precision: 10, scale: 4 }),
    priceWithoutVat: integer("priceWithoutVat"),
    priceUnit: varchar("priceUnit", { length: 255 }),
    sum: decimal("sum", { precision: 10, scale: 4 }),
    vatPercent: integer("vatPercent"),
    vatSum: integer("vatSum"),
    discountSum: integer("discountSum"),
    amountUnit: uuid("amountUnit").references(() => measure_unit.id, {}),
    num: varchar("num", { length: 255 }),
    productArticle: varchar("productArticle", { length: 255 }),
    supplierProduct: varchar("supplierProduct", { length: 255 }),
    supplierProductArticle: varchar("supplierProductArticle", { length: 255 }),
    amount: decimal("amount", { precision: 10, scale: 4 }),
    invoice_id: uuid("invoice_id").references(() => invoices.id, {}),
    storeId: uuid("storeId"),
    storeCode: varchar("storeCode", { length: 255 }),
    invoiceincomingdate: timestamp("invoiceincomingdate", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => {
    return {
      incomingInvoiceItems_pkey: primaryKey({
        columns: [table.id, table.invoiceincomingdate],
        name: "incomingInvoiceItems_pkey",
      }),
    };
  }
);

export const internal_transfer = pgTable(
  "internal_transfer",
  {
    id: uuid("id").defaultRandom().notNull(),
    dateIncoming: timestamp("dateIncoming", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    }),
    documentNumber: varchar("documentnumber", { length: 255 }),
    status: varchar("status", { length: 255 }),
    conceptionId: uuid("conceptionId").references(() => conception.id, {}),
    storeFromId: uuid("storeFromId").references(() => corporation_store.id, {}),
    storeToId: uuid("storeToId").references(() => corporation_store.id, {}),
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
    productId: uuid("productId").references(() => nomenclature_element.id, {}),
    amount: decimal("amount", { precision: 10, scale: 4 }),
    measureUnitId: uuid("measureUnitId").references(() => measure_unit.id, {}),
    containerId: varchar("containerId", { length: 255 }),
    cost: integer("cost"),
    internal_transfer_id: uuid("internal_transfer_id").references(
      () => internal_transfer.id,
      {}
    ),
    num: varchar("num", { length: 255 }),
    internaltransferdate: timestamp("internaltransferdate", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    }),
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

export const writeoff = pgTable(
  "writeoff",
  {
    id: uuid("id").notNull(),
    dateIncoming: timestamp("dateincoming", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    }),
    documentNumber: varchar("documnentNumber", { length: 255 }),
    status: varchar("status", { length: 255 }),
    conceptionId: uuid("conceptionId").references(() => conception.id, {}),
    comment: varchar("comment", { length: 255 }),
    storeId: uuid("storeId").references(() => corporation_store.id, {}),
  },
  (table) => {
    return {
      writeoff_pkey: primaryKey({
        columns: [table.id, table.dateIncoming],
        name: "writeoff_pkey",
      }),
    };
  }
);

export const writeoff_items = pgTable(
  "writeoff_items",
  {
    id: uuid("id").defaultRandom().notNull(),
    productId: uuid("productId").references(() => nomenclature_element.id, {}),
    productSizeId: varchar("productSizeId", { length: 255 }),
    amountFactor: integer("amountFactor"),
    amount: decimal("amount", { precision: 10, scale: 4 }),
    measureUnitId: uuid("measureUnitId").references(() => measure_unit.id, {}),
    containerId: varchar("containerId", { length: 255 }),
    cost: integer("cost"),
    writeoff_id: uuid("writeoff_id").references(() => writeoff.id, {}),
    writeoffincomingdate: timestamp("writeoffincomingdate", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => {
    return {
      writeoffItems_pkey: primaryKey({
        columns: [table.id, table.writeoffincomingdate],
        name: "writeoffItems_pkey",
      }),
    };
  }
);
export const corporation_store = pgTable(
  "corporation_store",
  {
    id: uuid("id").defaultRandom().notNull(),
    parentId: varchar("parentId", { length: 255 }),
    code: varchar("code", { length: 255 }),
    name: varchar("name", { length: 255 }),
    type: varchar("type", { length: 255 }),
  },
  (table) => {
    return {
      corporation_store_pkey: primaryKey({
        columns: [table.id],
        name: "corporation_store_pkey",
      }),
    };
  }
);

export const report_olap = pgTable(
  "report_olap",
  {
    id: uuid("id").defaultRandom().notNull(),
    dateTime: timestamp("dateTime", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    }),
    productId: uuid("productId").references(() => nomenclature_element.id, {}),
    productName: varchar("productName", { length: 255 }),
    productType: varchar("productType", { length: 255 }),
    sessionGroup: varchar("sessionGroup", { length: 255 }),
    transactionType: varchar("transactionType", { length: 255 }),
    amauntOut: doublePrecision("amauntOut").default(10.1),
  },
  (table) => {
    return {
      reportOlap_pkey: primaryKey({
        columns: [table.id],
        name: "reportOlap_pkey",
      }),
    };
  }
);

export const corporation_terminals = pgTable(
  "corporation_terminals",
  {
    id: uuid("id").defaultRandom().notNull(),
    name: varchar("name", { length: 255 }),
    computerName: varchar("computerName", { length: 255 }),
    anonymous: varchar("anonymous", { length: 255 }),
  },
  (table) => {
    return {
      corporationTerminals_pkey: primaryKey({
        columns: [table.id],
        name: "corporationTerminals_pkey",
      }),
    };
  }
);

export const corporation_department = pgTable(
  "corporation_department",
  {
    id: uuid("id").defaultRandom().notNull(),
    parentId: varchar("parentId", { length: 255 }),
    name: varchar("name", { length: 255 }),
    type: varchar("type", { length: 255 }),
  },
  (table) => {
    return {
      corporation_department_pkey: primaryKey({
        columns: [table.id],
        name: "corporation_department_pkey",
      }),
    };
  }
);
export const corporation_groups = pgTable(
  "corporation_groups",
  {
    id: uuid("id").defaultRandom().notNull(),
    name: varchar("name", { length: 255 }),
    departmentId: uuid("departmentId").references(
      () => corporation_department.id,
      {}
    ),
    groupServiceMode: varchar("groupServiceMode", { length: 255 }),
  },
  (table) => {
    return {
      corporation_groups_pkey: primaryKey({
        columns: [table.id],
        name: "corporation_groups_pkey",
      }),
    };
  }
);

export const balance_store = pgTable(
  "balance_store",
  {
    id: uuid("id").defaultRandom().notNull(),
    storeId: uuid("storeId").references(() => corporation_store.id, {}),
    productId: uuid("productId").references(() => nomenclature_element.id, {}),
    amount: doublePrecision("amount").default(10.1),
    sum: doublePrecision("sum").default(10.1),
    enddate: timestamp("enddate", {
      precision: 5,
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => {
    return {
      balance_store_pkey: primaryKey({
        columns: [table.id],
        name: "balance_store_pkey",
      }),
    };
  }
);

export const users_stores = pgTable(
  "users_stores",
  {
    id: uuid("id").defaultRandom().notNull(),
    user_id: uuid("user_id").references(() => users.id, {}),
    corporation_store_id: uuid("corporation_store_id").references(
      () => corporation_store.id,
      {}
    ),
  },
  (table) => {
    return {
      users_stores_pkey: primaryKey({
        columns: [table.id],
        name: "users_stores_pkey",
      }),
    };
  }
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").notNull(),
    code: varchar("code", { length: 255 }),
    name: varchar("name", { length: 255 }),
    cardNumber: varchar("cardNumber", { length: 255 }),
    taxpayerIdNumber: varchar("taxpayerIdNumber", { length: 255 }),
    snils: varchar("snils", { length: 255 }),
    departmentCodes: varchar("departmentCodes", { length: 255 }),
    responsibilityDepartmentCodes: varchar("responsibilityDepartmentCodes", {
      length: 255,
    }),
    deleted: boolean("deleted"),
    supplier: boolean("supplier"),
    employee: boolean("employee"),
    client: boolean("client"),
    representsStore: boolean("representsStore"),
    representedStoreId: uuid("representedStoreId"),
  },
  (table) => {
    return {
      suppliers_pkey: primaryKey({
        columns: [table.id],
        name: "suppliers_pkey",
      }),
    };
  }
);
