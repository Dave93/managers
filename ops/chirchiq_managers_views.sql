CREATE SCHEMA IF NOT EXISTS chirchiq;

CREATE OR REPLACE VIEW chirchiq.orders AS
SELECT * FROM public.orders
WHERE restaurant_group_id = 'cac95452-29ae-4ffb-a595-0fe073c73358';

CREATE OR REPLACE VIEW chirchiq.order_items AS
SELECT * FROM public.order_items
WHERE restaurant_group_id = 'cac95452-29ae-4ffb-a595-0fe073c73358';

CREATE OR REPLACE VIEW chirchiq.stoplist_events AS
SELECT s.*, n.name_uz AS product_name_uz FROM public.stoplist_events s
LEFT JOIN public.les_product_names n ON n.product_id = s.product_id
WHERE s.terminal_iiko_id = 'cac95452-29ae-4ffb-a595-0fe073c73358';

CREATE OR REPLACE VIEW chirchiq.stoplist_intervals AS
SELECT s.*, n.name_uz AS product_name_uz FROM public.stoplist_intervals s
LEFT JOIN public.les_product_names n ON n.product_id = s.product_id
WHERE s.terminal_iiko_id = 'cac95452-29ae-4ffb-a595-0fe073c73358';

CREATE OR REPLACE VIEW chirchiq.dish_cost_daily AS
SELECT day, dish_name, dish_type, qty, revenue, cost FROM public.dish_cost_daily
WHERE restaurant_group_id = 'cac95452-29ae-4ffb-a595-0fe073c73358';

GRANT CONNECT ON DATABASE managers TO chirchiq_ro;
GRANT USAGE ON SCHEMA chirchiq TO chirchiq_ro;
GRANT SELECT ON chirchiq.orders, chirchiq.order_items, chirchiq.stoplist_events, chirchiq.stoplist_intervals, chirchiq.dish_cost_daily TO chirchiq_ro;
