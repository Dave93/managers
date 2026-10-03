# Deploying the managers backend

The production process (`pm2` id 23, **office_api**) does **not** run TypeScript.
It runs a **compiled bun binary** at `/home/davr/managers/backend/app`. Editing
a `.ts` file on the server changes nothing until that binary is rebuilt.

> **The single most expensive mistake here:** `pm2 restart office_api` after
> editing source. It restarts the OLD binary, the logs look healthy, and the
> change appears to have "not worked" — sending you off debugging code that was
> never running. A restart is only meaningful *after* `app` has been replaced.

## Standard deploy

Run from `/home/davr/managers/backend`.

```bash
# 1. Back up the running binary. Keep the timestamp — this is the rollback.
cp app app.bak_$(date +%s)

# 2. Build the new one NEXT TO it, never over it: a build that fails halfway
#    must not be able to leave a truncated binary where the good one was.
/root/.bun/bin/bun build --compile src/index.ts --outfile app.new

# 3. Smoke-test the new binary before it becomes `app`.
#    !! KEEP THIS WINDOW SHORT — a few seconds, just the two curls below. !!
#    The dev-mode boot also calls startCreditJobs(), which registers the job
#    schedulers and starts a SECOND credit-maintenance worker against the
#    PRODUCTION Redis. That worker is not read-only: if the reaper fires while
#    the smoke instance is up, it really voids expired holds and really posts to
#    the alert channel. There is no isolation knob for the queue (startCreditJobs
#    takes only host/port), which is why the fix is "don't leave it running",
#    not a flag.
#    - NODE_ENV=development so it boots single-process (no cluster fork) and
#      still starts the credit socket + jobs, which is what we want to exercise.
#    - a THROWAWAY port and a THROWAWAY socket path: the real socket at
#      /home/davr/managers/run/credit-internal.sock is live and serving Laravel.
#      Binding it here would yank production's socket out from under it.
NODE_ENV=development PORT=6798 \
CREDIT_SOCKET_PATH=/tmp/credit-smoke-$$.sock \
  ./app.new &
SMOKE_PID=$!
# MEASURED 2026-08-11: this binary takes ~21s to bind. `sleep 3` (the old value
# here) makes every curl below fail and reads as a broken build for a perfectly
# good one. Wait for the port instead of guessing.
for i in $(seq 1 40); do
  curl -sS -m 1 -o /dev/null http://127.0.0.1:6798/ && break || sleep 1
done

# 4. Prove it actually serves. Both must answer.
curl -sS -m 5 http://127.0.0.1:6798/ -o /dev/null -w 'http: %{http_code}\n'
curl -sS -m 5 --unix-socket /tmp/credit-smoke-$$.sock \
  -X POST http://localhost/internal/credit/check \
  -H 'content-type: application/json' -d '{"phone":"+998000000000"}'
# expected: {"allowed":false,"reason":"unknown_phone"}
# A connection refused / empty reply here means the binary failed to boot —
# STOP, read its output, do not swap it in.

# 5. Stop the smoke instance BEFORE swapping (it holds the DB pool and, on a
#    dev-mode boot, its own bullmq workers).
kill $SMOKE_PID; wait $SMOKE_PID 2>/dev/null

# 6. Swap and restart. mv is atomic within the filesystem.
mv app.new app
pm2 restart office_api

# 7. Confirm the new process is actually up, and that the credit socket was
#    re-created (mode must be srw-rw---- and the mtime must be from just now).
pm2 list | grep office_api
ls -l /home/davr/managers/run/credit-internal.sock
pm2 logs office_api --lines 40 --nostream
```

## Rollback

```bash
cd /home/davr/managers/backend
mv app.bak_<timestamp> app && pm2 restart office_api
```

Nothing in the credit module writes on boot, so rolling the binary back is safe
on its own — **but a rollback does not undo a migration**. If the deploy included
one, check whether the older binary can live with the new schema before rolling
back (added enum values and added indexes are backward compatible; a dropped or
renamed column is not).

## Migrations

Migrations are **not** part of the binary and are **not** applied on boot. Apply
them explicitly, before restarting the process that needs them:

```bash
cd /home/davr/managers/backend
/root/.bun/bin/bunx drizzle-kit generate   # only when schema.ts changed
/root/.bun/bin/bunx drizzle-kit migrate
/root/.bun/bin/bunx drizzle-kit generate   # must now report "No schema changes"
```

That last line is the real check: if a second `generate` still emits a
migration, the applied SQL and `drizzle/schema.ts` disagree, and the next person
to run `generate` gets a surprise diff mixed into their own change.

Drizzle applies **all pending migrations in one transaction**. Two consequences
worth knowing before hand-writing SQL:

- `ALTER TYPE ... ADD VALUE` is allowed inside a transaction (PG >= 12), but the
  new value **cannot be used** in that same transaction. This is why
  `credit_entries_op_uniq` (migration 0012) has a whitelist predicate listing the
  six original entry types instead of the more obvious `WHERE entry_type <> 'amend'`.
- A failure anywhere rolls back everything, so a partially applied batch is not
  a state you have to reason about.

## Credit-specific checks after a deploy

```bash
# socket exists, right mode, owned by the run dir's group
ls -ld /home/davr/managers/run /home/davr/managers/run/credit-internal.sock

# the maintenance jobs registered (bullmq job schedulers, keyed by id — a
# re-register updates the schedule rather than orphaning the old one)
pm2 logs office_api --lines 100 --nostream | grep -i credit

# ...and that the registered set is EXACTLY the two we expect. Must list
# credit-reconcile and credit-hold-reaper, nothing else:
redis-cli ZRANGE bull:credit-maintenance:repeat 0 -1
# A member that is a long hex HASH rather than a readable job name is a stale
# legacy repeatable from the pre-upsertJobScheduler `add(..., {repeat})` API.
# Those still fire on their old schedule alongside the new ones — i.e. the job
# runs twice — and they are invisible in the logs because both spellings print
# the same job name. Remove with queue.removeRepeatableByKey(<member>).
```

In production `index.ts` starts the credit socket, the bullmq jobs and the
config cache **only on the cluster primary**; the two forked HTTP workers never
open a credit DB pool. If you are looking for credit log lines, they are in the
primary's output, interleaved with everything else in `pm2 logs office_api`.
