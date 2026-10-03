-- Stop-list history: hypertable + partial unique index + continuous aggregate.
-- Applied out-of-band after the drizzle migration that creates the plain tables
-- (same convention as timescale_scripts.sql). TimescaleDB 2.16.1.

-- 1. Hypertable over the append-only event stream.
SELECT create_hypertable(
  'stoplist_events',
  by_range('event_at', INTERVAL '1 month'),
  migrate_data => true,
  if_not_exists => true
);

-- 2. Exactly one OPEN interval per (brand, terminal, product) — the ingestion
--    endpoint relies on this for ON CONFLICT ... WHERE ended_at IS NULL.
CREATE UNIQUE INDEX IF NOT EXISTS uq_stoplist_intervals_open
  ON stoplist_intervals (brand, terminal_id, product_id)
  WHERE ended_at IS NULL;

-- 3. Daily continuous aggregate: stop/release volumes per brand and terminal.
CREATE MATERIALIZED VIEW IF NOT EXISTS stoplist_daily_aggregation
WITH (timescaledb.continuous) AS
SELECT
  time_bucket('1 day', event_at) AS bucket,
  brand,
  terminal_id,
  count(*) FILTER (WHERE action = 'stop')    AS stops,
  count(*) FILTER (WHERE action = 'release') AS releases
FROM stoplist_events
GROUP BY 1, 2, 3
WITH NO DATA;

SELECT add_continuous_aggregate_policy(
  'stoplist_daily_aggregation',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => true
);
