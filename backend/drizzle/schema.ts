import { pgTable, uniqueIndex, foreignKey, pgEnum, uuid, varchar, boolean, timestamp, text, doublePrecision, index, integer, time, primaryKey } from "drizzle-orm/pg-core"
import { relations, sql } from "drizzle-orm"

export const user_status = pgEnum("user_status", ['inactive', 'blocked', 'active'])
export const organization_system_type = pgEnum("organization_system_type", ['jowi', 'r_keeper', 'iiko'])
export const work_schedule_entry_status = pgEnum("work_schedule_entry_status", ['closed', 'open'])
export const organization_payment_types = pgEnum("organization_payment_types", ['client', 'card', 'cash'])
export const report_status = pgEnum("report_status", ['cancelled', 'comfirmed', 'checking', 'sent'])
export const report_item_type = pgEnum("report_item_type", ['outcome', 'income'])


export const roles = pgTable("roles", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	name: varchar("name", { length: 50 }).notNull(),
	code: varchar("code", { length: 50 }),
	active: boolean("active").default(true).notNull(),
	created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by: uuid("created_by").references(() => users.id, { onUpdate: "cascade" }),
	updated_by: uuid("updated_by").references(() => users.id, { onUpdate: "cascade" }),
},
	(table) => {
		return {
			UQ_648e3f5447f725579d7d4ffdfb7: uniqueIndex("UQ_648e3f5447f725579d7d4ffdfb7").on(table.name),
			UQ_0e2c0e1b4b0b0b0b0b0b0b0b0b0: uniqueIndex("UQ_0e2c0e1b4b0b0b0b0b0b0b0b0b0").on(table.code),
		}
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
	created_by: uuid("created_by").references(() => users.id, { onUpdate: "cascade" }),
	updated_by: uuid("updated_by").references(() => users.id, { onUpdate: "cascade" }),
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
	organization_id: uuid("organization_id").notNull().references(() => organization.id, { onUpdate: "cascade" }),
	manager_name: text("manager_name"),
	created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const api_tokens = pgTable("api_tokens", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	active: boolean("active").default(false).notNull(),
	token: text("token").notNull(),
	organization_id: uuid("organization_id").notNull().references(() => organization.id, { onUpdate: "cascade" }),
	created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by: uuid("created_by").references(() => users.id, { onUpdate: "cascade" }),
	updated_by: uuid("updated_by").references(() => users.id, { onUpdate: "cascade" }),
},
	(table) => {
		return {
			id_key: uniqueIndex("api_tokens_id_key").on(table.id),
			token_key: uniqueIndex("api_tokens_token_key").on(table.token),
		}
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
			UQ_a000cca60bcf04454e727699490: uniqueIndex("UQ_a000cca60bcf04454e727699490").on(table.phone),
			UQ_0e2c0e1b4b5b0b0b0b0b0b0b0b0: uniqueIndex("UQ_0e2c0e1b4b5b0b0b0b0b0b0b0b0").on(table.email),
			UQ_0e2c0e1b3b0b0b0b0b0b0b0b0b0: uniqueIndex("UQ_0e2c0e1b3b0b0b0b0b0b0b0b0b0").on(table.login),
			fki_users_login: index("fki_users_login").on(table.login),
		}
	});

export const sessions = pgTable("sessions", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	user_id: uuid("user_id").notNull().references(() => users.id, { onDelete: "restrict", onUpdate: "cascade" }),
	user_agent: text("user_agent").notNull(),
	device_name: text("device_name").notNull(),
	created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const work_schedules = pgTable("work_schedules", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	name: text("name").notNull(),
	active: boolean("active").default(true).notNull(),
	organization_id: uuid("organization_id").notNull().references(() => organization.id, { onUpdate: "cascade" }),
	days: text("days").array(),
	start_time: time("start_time", { precision: 5, withTimezone: true }).notNull(),
	end_time: time("end_time", { precision: 5, withTimezone: true }).notNull(),
	max_start_time: time("max_start_time", { precision: 5, withTimezone: true }).notNull(),
	bonus_price: integer("bonus_price").default(0).notNull(),
	created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by: uuid("created_by").references(() => users.id, { onUpdate: "cascade" }),
	updated_by: uuid("updated_by").references(() => users.id, { onUpdate: "cascade" }),
});

export const work_schedule_entries = pgTable("work_schedule_entries", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	user_id: uuid("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
	work_schedule_id: uuid("work_schedule_id").notNull().references(() => work_schedules.id, { onUpdate: "cascade" }),
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
	created_by: uuid("created_by").references(() => users.id, { onUpdate: "cascade" }),
	updated_by: uuid("updated_by").references(() => users.id, { onUpdate: "cascade" }),
},
	(table) => {
		return {
			fki_work_schedule_entries_current_status: index("fki_work_schedule_entries_current_status").on(table.current_status),
			fki_work_schedule_entries_user_id: index("fki_work_schedule_entries_user_id").on(table.user_id),
		}
	});

export const credentials = pgTable("credentials", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	key: text("key").notNull(),
	model: text("model").notNull(),
	type: text("type").notNull(),
	created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by: uuid("created_by").references(() => users.id, { onUpdate: "cascade" }),
	updated_by: uuid("updated_by").references(() => users.id, { onUpdate: "cascade" }),
	model_id: text("model_id").notNull(),
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

export const timesheet = pgTable("timesheet", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	user_id: uuid("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
	is_late: boolean("is_late").default(false).notNull(),
	date: timestamp("date", { precision: 5, withTimezone: true, mode: 'string' }).notNull(),
	created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const scheduled_reports = pgTable("scheduled_reports", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	name: text("name").notNull(),
	code: text("code").notNull(),
	cron: text("cron").notNull(),
	created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const report_groups = pgTable("report_groups", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	name: text("name").notNull(),
	code: text("code").notNull(),
	created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	parent_id: uuid("parent_id"),
},
	(table) => {
		return {
			FK_parent_id_report_groups: foreignKey({
				columns: [table.parent_id],
				foreignColumns: [table.id],
				name: "FK_parent_id_report_groups"
			}).onUpdate("cascade"),
		}
	});

export const permissions = pgTable("permissions", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	slug: varchar("slug", { length: 160 }).notNull(),
	description: varchar("description", { length: 60 }).notNull(),
	active: boolean("active").default(true).notNull(),
	created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	created_by: uuid("created_by").references(() => users.id, { onUpdate: "cascade" }),
	updated_by: uuid("updated_by").references(() => users.id, { onUpdate: "cascade" }),
},
	(table) => {
		return {
			UQ_d090ad82a0e97ce764c06c7b312: uniqueIndex("UQ_d090ad82a0e97ce764c06c7b312").on(table.slug),
		}
	});

export const scheduled_reports_subscription = pgTable("scheduled_reports_subscription", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	report_id: uuid("report_id").notNull().references(() => scheduled_reports.id, { onUpdate: "cascade" }),
	user_id: uuid("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
	created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const reports_status = pgTable("reports_status", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	code: varchar("code", { length: 255 }).notNull(),
	color: varchar("color", { length: 255 }).notNull(),
	created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	label: varchar("label", { length: 255 }).notNull(),
});

export const users_terminals = pgTable("users_terminals", {
	user_id: uuid("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
	terminal_id: uuid("terminal_id").notNull().references(() => terminals.id, { onUpdate: "cascade" }),
},
	(table) => {
		return {
			PK_users_terminals_id: primaryKey({ columns: [table.user_id, table.terminal_id], name: "PK_users_terminals_id" })
		}
	});

export const users_work_schedules = pgTable("users_work_schedules", {
	user_id: uuid("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
	work_schedule_id: uuid("work_schedule_id").notNull().references(() => work_schedules.id, { onUpdate: "cascade" }),
},
	(table) => {
		return {
			PK_users_work_schedules_id: primaryKey({ columns: [table.user_id, table.work_schedule_id], name: "PK_users_work_schedules_id" })
		}
	});

export const users_permissions = pgTable("users_permissions", {
	user_id: uuid("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
	permission_id: uuid("permission_id").notNull().references(() => permissions.id, { onUpdate: "cascade" }),
	created_by: uuid("created_by").references(() => users.id, { onUpdate: "cascade" }),
	updated_by: uuid("updated_by").references(() => users.id, { onUpdate: "cascade" }),
},
	(table) => {
		return {
			PK_7f3736984cd8546a1e418005561: primaryKey({ columns: [table.user_id, table.permission_id], name: "PK_7f3736984cd8546a1e418005561" })
		}
	});

export const roles_permissions = pgTable("roles_permissions", {
	role_id: uuid("role_id").notNull().references(() => roles.id, { onUpdate: "cascade" }),
	permission_id: uuid("permission_id").notNull().references(() => permissions.id, { onUpdate: "cascade" }),
	created_by: uuid("created_by").references(() => users.id, { onUpdate: "cascade" }),
	updated_by: uuid("updated_by").references(() => users.id, { onUpdate: "cascade" }),
},
	(table) => {
		return {
			PK_0cd11f0b35c4d348c6ebb9b36b7: primaryKey({ columns: [table.role_id, table.permission_id], name: "PK_0cd11f0b35c4d348c6ebb9b36b7" })
		}
	});

export const users_roles = pgTable("users_roles", {
	user_id: uuid("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
	role_id: uuid("role_id").notNull().references(() => roles.id, { onUpdate: "cascade" }),
	created_by: uuid("created_by").references(() => users.id, { onUpdate: "cascade" }),
	updated_by: uuid("updated_by").references(() => users.id, { onUpdate: "cascade" }),
},
	(table) => {
		return {
			PK_c525e9373d63035b9919e578a9c: primaryKey({ columns: [table.user_id, table.role_id], name: "PK_c525e9373d63035b9919e578a9c" })
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

export const reports = pgTable("reports", {
	id: uuid("id").defaultRandom().notNull(),
	date: timestamp("date", { precision: 5, withTimezone: true, mode: 'string' }).notNull(),
	status_id: uuid("status_id").notNull().references(() => reports_status.id, { onUpdate: "cascade" }),
	user_id: uuid("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
	terminal_id: uuid("terminal_id").notNull().references(() => terminals.id, { onUpdate: "cascade" }),
	cash_ids: text("cash_ids").array(),
	total_amount: integer("total_amount").default(0).notNull(),
	total_manager_price: integer("total_manager_price").default(0).notNull(),
	difference: integer("difference").default(0).notNull(),
	arryt_income: integer("arryt_income").default(0).notNull(),
},
	(table) => {
		return {
			reports_pkey: primaryKey({ columns: [table.id, table.date], name: "reports_pkey" })
		}
	});

export const reports_items = pgTable("reports_items", {
	id: uuid("id").defaultRandom().notNull(),
	report_id: uuid("report_id").notNull(),
	label: varchar("label", { length: 255 }).notNull(),
	type: report_item_type("type").notNull(),
	amount: integer("amount").default(0).notNull(),
	source: varchar("source", { length: 255 }).notNull(),
	group_id: uuid("group_id").references(() => report_groups.id, { onUpdate: "cascade" }),
	report_date: timestamp("report_date", { precision: 5, withTimezone: true, mode: 'string' }).notNull(),
	created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updated_at: timestamp("updated_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
},
	(table) => {
		return {
			FK_reports_id: foreignKey({
				columns: [table.report_id, table.report_date],
				foreignColumns: [reports.id, reports.date],
				name: "FK_reports_id"
			}).onUpdate("cascade"),
			reports_items_pkey: primaryKey({ columns: [table.id, table.report_date], name: "reports_items_pkey" })
		}
	});

export const reports_logs = pgTable("reports_logs", {
	id: uuid("id").defaultRandom().notNull(),
	reports_id: uuid("reports_id").notNull(),
	reports_item_id: uuid("reports_item_id").notNull(),
	before_json: text("before_json"),
	after_json: text("after_json"),
	created_at: timestamp("created_at", { precision: 5, withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	user_id: uuid("user_id").notNull().references(() => users.id, { onUpdate: "cascade" }),
	before_text: text("before_text"),
	after_text: text("after_text"),
	report_date: timestamp("report_date", { precision: 5, withTimezone: true, mode: 'string' }).notNull(),
},
	(table) => {
		return {
			FK_reports_logs_reports_id: foreignKey({
				columns: [table.reports_id, table.report_date],
				foreignColumns: [reports.id, reports.date],
				name: "FK_reports_logs_reports_id"
			}).onUpdate("cascade"),
			FK_reports_logs_reports_item_id: foreignKey({
				columns: [table.reports_item_id, table.report_date],
				foreignColumns: [reports_items.id, reports_items.report_date],
				name: "FK_reports_logs_reports_item_id"
			}).onUpdate("cascade"),
			reports_logs_pkey: primaryKey({ columns: [table.id, table.report_date], name: "reports_logs_pkey" })
		}
	});