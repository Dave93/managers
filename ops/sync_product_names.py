#!/usr/bin/env python3
"""Snapshot les_api.products names (ru custom_name + uz from attribute_data) into
managers.public.les_product_names. Used by chirchiq.stoplist_* views to show Uzbek
names. Products change rarely; run weekly."""
import subprocess, io
q = ("select id, coalesce(custom_name,''), coalesce(json_unquote(json_extract(attribute_data,'$.name.chopar.uz')),'') "
     "from les_api.products where deleted_at is null")
tsv = subprocess.run(["mysql", "-N", "-B", "-e", q], capture_output=True, text=True, check=True).stdout
rows = []
for l in tsv.splitlines():
    p = l.split("\t")
    if len(p) != 3: continue
    ru, uz = p[1].strip(), p[2].strip()
    if uz.lower() == "null": uz = ""
    rows.append((int(p[0]), ru, uz))
if len(rows) < 100:
    raise SystemExit(f"refusing to replace names with only {len(rows)} rows")
buf = io.StringIO()
for i, ru, uz in rows:
    esc = lambda s: s.replace("\\", "\\\\").replace("\t", " ").replace("\n", " ")
    buf.write(f"{i}\t{esc(ru)}\t{esc(uz)}\n")
sql = ("begin;\ncreate table if not exists public.les_product_names "
       "(product_id integer primary key, name_ru text, name_uz text);\n"
       "truncate public.les_product_names;\ncopy public.les_product_names from stdin;\n" + buf.getvalue() + "\\.\ncommit;\n")
subprocess.run(["sudo", "-u", "postgres", "psql", "-d", "managers", "-X", "-q", "-v", "ON_ERROR_STOP=1"], input=sql, text=True, check=True)
print("loaded", len(rows))
