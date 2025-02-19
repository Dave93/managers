select create_hypertable('order_items', by_range('open_date_typed', INTERVAL '1 month'), migrate_data := true)
select create_hypertable('orders', by_range('open_date_typed', INTERVAL '1 month'), migrate_data := true)
select create_hypertable('orders_by_time', by_range('open_time'), migrate_data := true)



CREATE MATERIALIZED VIEW IF NOT EXISTS revenue_daily_aggregation
WITH (timescaledb.continuous) AS
    SELECT time_bucket(INTERVAL '1 day', orders.open_date_typed) AS bucket,
           restaurant_group_id,
           department_id,
           count(*) AS order_count,
           SUM(dish_discount_sum_int) AS total_revenue
    FROM orders
    GROUP BY bucket, restaurant_group_id, department_id;
CREATE MATERIALIZED VIEW IF NOT EXISTS revenue_weekly_aggregation
WITH (timescaledb.continuous) AS
    SELECT time_bucket(INTERVAL '1 week', orders.open_date_typed) AS bucket,
           restaurant_group_id,
           department_id,
           count(*) AS order_count,
           SUM(dish_discount_sum_int) AS total_revenue
    FROM orders
    GROUP BY bucket, restaurant_group_id, department_id;
CREATE MATERIALIZED VIEW IF NOT EXISTS revenue_monthly_aggregation
WITH (timescaledb.continuous) AS
    SELECT time_bucket(INTERVAL '1 month', orders.open_date_typed) AS bucket,
           restaurant_group_id,
           department_id,
           count(*) AS order_count,
           SUM(dish_discount_sum_int) AS total_revenue
    FROM orders
    GROUP BY bucket, restaurant_group_id, department_id;


SELECT add_continuous_aggregate_policy('revenue_daily_aggregation',
  start_offset => INTERVAL '2 months',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');

SELECT add_continuous_aggregate_policy('revenue_weekly_aggregation',
  start_offset => INTERVAL '3 months',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 hour');

SELECT add_continuous_aggregate_policy('revenue_monthly_aggregation',
  start_offset => INTERVAL '1 year',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 hour');


CREATE MATERIALIZED VIEW IF NOT EXISTS orders_hourly_aggregation
WITH (timescaledb.continuous) AS
    SELECT time_bucket(INTERVAL '1 hour', orders_by_time.open_time) AS bucket,
           restaurant_group_id,
           department_id,
           count(*) AS order_count,
           SUM(dish_discount_sum_int) AS total_revenue
    FROM orders_by_time
    GROUP BY bucket, restaurant_group_id, department_id;


SELECT add_continuous_aggregate_policy('orders_hourly_aggregation',
  start_offset => INTERVAL '2 months',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour');


CREATE MATERIALIZED VIEW IF NOT EXISTS product_daily_aggregation
WITH (timescaledb.continuous) AS
    SELECT time_bucket(INTERVAL '1 day', open_date_typed) AS bucket,
           restaurant_group_id,
           department_id,
           dish_id,
           dish_name,
           dish_discount_sum_int,
           count(*) as total_count
    FROM order_items
    GROUP BY bucket, dish_id, dish_name, restaurant_group_id, department_id, dish_discount_sum_int;



SELECT add_continuous_aggregate_policy('product_daily_aggregation',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 day');