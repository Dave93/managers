CREATE TABLE "inventory_turnover" (
	"period" date NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"tx_type" varchar(40) NOT NULL,
	"qty_in" numeric(14, 4) NOT NULL,
	"qty_out" numeric(14, 4) NOT NULL,
	"sum_in" numeric(18, 4) NOT NULL,
	"sum_out" numeric(18, 4) NOT NULL,
	CONSTRAINT "inventory_turnover_period_store_id_product_id_tx_type_pk" PRIMARY KEY("period","store_id","product_id","tx_type")
);
--> statement-breakpoint
CREATE TABLE "inventory_turnover_balance" (
	"period" date NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"start_qty" numeric(14, 4) NOT NULL,
	"start_sum" numeric(18, 4) NOT NULL,
	"end_qty" numeric(14, 4) NOT NULL,
	"end_sum" numeric(18, 4) NOT NULL,
	"consistent" boolean NOT NULL,
	CONSTRAINT "inventory_turnover_balance_period_store_id_product_id_pk" PRIMARY KEY("period","store_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_turnover_fetch" (
	"period" date NOT NULL,
	"store_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_through" date NOT NULL,
	CONSTRAINT "inventory_turnover_fetch_period_store_id_pk" PRIMARY KEY("period","store_id")
);
