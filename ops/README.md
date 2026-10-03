# ops

Server-side helpers that live outside the app services. Deployed copies are in `/root/bin`
(scripts) and `/root` (SQL); keep both in sync.

| File | What | Schedule |
|---|---|---|
| `ops_data_watch.py` | Daily watchdog: open cash shifts > 30h, les_api vs OLAP delivery reconciliation per terminal. Alerts to the ops Telegram chat (token read from `/root/check_miners.sh`). `--dry-run` prints only. | `/etc/cron.d/ops_data_watch`, 07:15 |
| `sync_product_names.py` | Snapshots les_api product names (ru + uz) into `public.les_product_names` for the franchise views. | `/etc/cron.d/sync_product_names`, Mon 06:20 |
| `chirchiq_managers_views.sql` | Franchise (Chirchiq) views in schema `chirchiq`; apply with `sudo -u postgres psql -d managers < file`. | manual |

The cost loader is `cron/dish_cost_sync.ts` (compile with `bun build --compile`, cron `/etc/cron.d/dish_cost_sync`, 06:45).
