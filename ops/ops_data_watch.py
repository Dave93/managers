#!/usr/bin/env python3
"""Data-quality watchdog for the managers dashboards (les brand).

Two checks, run daily after the nightly OLAP sync:
  1. cash shifts still OPEN after 24h - iiko refuses to close orders on such a
     register, so its sales silently drop out of OLAP (Chirchiq, 17.09.2026).
  2. reconciliation: orders `done` in les_api vs delivery orders in managers.orders
     per terminal over a trailing window. A terminal whose OLAP side falls below
     THRESHOLD of the les_api side is losing data between iiko and the dashboards.

Alerts go to the ops Telegram chat used by check_miners.sh. Each finding is sent
once, then repeated (weekly for shifts, every 3 days for reconciliation) while it stays true.

  ops_data_watch.py            # check and send
  ops_data_watch.py --dry-run  # print only, no send, state untouched
"""
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request

DRY = "--dry-run" in sys.argv
STATE = "/var/lib/ops_data_watch.json"
MINERS = "/root/check_miners.sh"  # source of the ops bot token and chat id
OPEN_SHIFT_H = 30  # iiko limit is 24h; the shift table is synced twice a day, so leave slack
IGNORE_GROUPS = ('Ofis Test',)
WINDOW_DAYS = 3
MIN_ORDERS = 20
THRESHOLD = 0.7
REALERT_H = {"shift": 168, "recon": 72}


def sh(cmd, args):
    return subprocess.run(cmd + args, capture_output=True, text=True, check=True).stdout


def pg(sql):
    out = sh(["sudo", "-u", "postgres", "psql", "-d", "managers", "-X", "-At", "-F", "|"], ["-c", sql])
    return [l.split("|") for l in out.splitlines() if l]


def my(sql):
    out = sh(["mysql", "-N"], ["-e", sql])
    return [l.split("\t") for l in out.splitlines() if l]


def open_shifts():
    rows = pg(f"""
        select cs.id, coalesce(cs.iiko_group_name, cs.point_of_sale_id::text), cs.cash_reg_number,
               cs.session_number, to_char(cs.open_at at time zone 'Asia/Tashkent', 'DD.MM HH24:MI'),
               round(extract(epoch from now() - cs.open_at) / 3600)
        from cash_shifts cs
        where cs.status = 'OPEN' and cs.close_at is null
          and cs.open_at < now() - interval '{OPEN_SHIFT_H} hours'
          and coalesce(cs.iiko_group_name, '') not in ({",".join("'" + g + "'" for g in IGNORE_GROUPS)})
          -- only the newest shift of a register: forgotten older ones are history, not a live outage
          and not exists (select 1 from cash_shifts n where n.point_of_sale_id = cs.point_of_sale_id
                          and n.cash_reg_number = cs.cash_reg_number and n.open_at > cs.open_at)
        order by cs.open_at""")
    return [
        (f"shift:{r[0]}",
         f"🔓 <b>Касса открыта {r[5]} ч</b>: {r[1]}, касса {r[2]}, смена №{r[3]} (с {r[4]}).\n"
         f"Возможная причина пропажи продаж из OLAP и дашбордов: заказы на такой кассе не закрываются в iiko.")
        for r in rows
    ]


def reconciliation():
    # window ends yesterday: today's OLAP day is not synced yet
    end = "current_date - 1"
    les = my(f"""
        select t.terminal_id, t.name, count(*) from les_api.orders o
        join les_api.terminals t on t.id = o.terminal_id
        where o.status = 'done'
          and o.created_at >= curdate() - interval {WINDOW_DAYS} day and o.created_at < curdate()
        group by 1, 2""")
    olap = {r[0]: int(r[1]) for r in pg(f"""
        select restaurant_group_id::text, count(*) from orders
        where order_service_type like 'DELIVERY%'
          and open_date_typed >= current_date - {WINDOW_DAYS} and open_date_typed < current_date
        group by 1""")}
    out = []
    for gid, name, n in les:
        a, b = int(n), olap.get(gid, 0)
        if a >= MIN_ORDERS and b < THRESHOLD * a:
            out.append((
                f"recon:{gid}",
                f"📉 <b>{name}</b>: за {WINDOW_DAYS} дня в les_api {a} выполненных заказов, "
                f"а в OLAP только {b} доставок ({round(100 * b / a)}%).\n"
                f"Заказы не доходят до дашбордов: проверьте закрытие заказов и смены в iiko."))
    return out


def creds():
    text = open(MINERS).read()
    tok = re.search(r'^TELEGRAM_BOT_TOKEN="?([^"\n]+)"?', text, re.M).group(1)
    chat = re.search(r'^TELEGRAM_CHAT_ID="?([^"\n]+)"?', text, re.M).group(1)
    return tok, chat


def send(text):
    tok, chat = creds()
    data = urllib.parse.urlencode({"chat_id": chat, "parse_mode": "HTML", "text": text}).encode()
    urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/sendMessage", data, timeout=20).read()


def main():
    findings = open_shifts() + reconciliation()
    try:
        state = json.load(open(STATE))
    except (FileNotFoundError, ValueError):
        state = {}
    now = time.time()
    fresh = {}
    to_send = []
    for key, text in findings:
        last = state.get(key)
        if last is None or now - last > REALERT_H[key.split(':')[0]] * 3600:
            to_send.append(text)
            fresh[key] = now
        else:
            fresh[key] = last
    print(f"findings={len(findings)} to_send={len(to_send)}")
    for t in to_send:
        print("---\n" + t)
    if DRY:
        return
    if to_send:
        send("<b>Проверка данных managers</b>\n\n" + "\n\n".join(to_send))
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump(fresh, open(STATE, "w"))  # resolved findings drop out and can re-alert


if __name__ == "__main__":
    main()
