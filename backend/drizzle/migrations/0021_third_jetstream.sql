CREATE TABLE "staff_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name_ru" varchar(150) NOT NULL,
	"name_uz" varchar(150) NOT NULL,
	"group_key" varchar(20) NOT NULL,
	"is_trainee" boolean DEFAULT false NOT NULL,
	"trainee_of_code" varchar(50),
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "staff_role_id" uuid;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "grade" integer;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "shift" varchar(10);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "is_trainee" boolean;--> statement-breakpoint
CREATE UNIQUE INDEX "staff_roles_code_key" ON "staff_roles" USING btree ("code");--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_staff_role_id_staff_roles_id_fk" FOREIGN KEY ("staff_role_id") REFERENCES "public"."staff_roles"("id") ON DELETE no action ON UPDATE no action;