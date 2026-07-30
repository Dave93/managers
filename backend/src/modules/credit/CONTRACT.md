# B2B credit module — integration contract

For Plan 2 (admin UI / CRUD) and Plan 3 (Laravel client). This is the reference
for *what the module promises*; the reasoning behind individual decisions lives
in comments next to the code.

The service is reachable two ways, and they are not equivalent:

| | how | who |
|---|---|---|
| **Unix socket** | `POST` JSON to `/home/davr/managers/run/credit-internal.sock` (`CREDIT_SOCKET_PATH`) | Laravel (Plan 3) |
| **Direct import** | `import { ... } from "src/modules/credit/service"` | admin UI / workers in this same codebase (Plan 2) |

Filesystem permissions on the socket are the **entire** authentication boundary.
There is no token, no app-level secret. Anything that can open the socket can
move money.

---

## 1. Identities and formats

**`order_id` is Laravel's `orders.id`, as a string.** Not the order *number*, not
a hashid. chopar and les share a CRM order-number space and their numbers
collide outright (documented in the miniapp cross-analytics work), so a number
cannot identify an order here. `(brand, order_id)` is unique across the whole
hold table and is the key every operation below is idempotent on.

**Money is integer tiyins.** Fractional amounts are rejected at the service level,
not only by the socket's JSON schema — Plan 2 calls the service directly and does
not cross that schema.

**Phone canonical form is E.164 with a plus: `+998XXXXXXXXX`.** Store it that way
in `credit_company_phones.phone`. On the read path the module normalizes
formatting and a missing `+` (`998901234567`, `+998 90 123 45 67` both resolve),
but anything further from canonical simply will not match — the lookup is a
single indexed equality compare on purpose, and a fallback scan would make every
checkout a sequential scan of the phone table. **Normalize at write time.**

---

## 2. Socket endpoints

Every endpoint is `POST` with a JSON body. Three failure layers, and they are
distinguishable on purpose:

| layer | HTTP | body |
|---|---|---|
| schema rejected the request | **422** | Elysia's own validation body |
| service returned a business outcome | **200** | the tables below (including declines and `service_error`) |
| the call blew up (uncaught throw, DB down) | **500** | endpoint-shaped `service_error` body (see each table) |

**A 422 is a client bug, never a service outage** — the request never reached
`service.ts` and no state changed. It must **not** count toward Plan 3's circuit
breaker; retrying it verbatim will always fail. Likewise **`service_error` inside
a 200 body must not trip the breaker**: the socket was healthy and answered. Only
transport-level failures (socket missing, connection refused, timeout) and 5xx
responses are breaker events.

### `/internal/credit/check` — read-only pre-flight

Request: `{ phone: string, amount?: integer >= 1 }`

| 200 body | meaning |
|---|---|
| `{allowed:false, reason:"unknown_phone"}` | phone is not on any active company |
| `{allowed:false, reason:"suspended"}` | company exists, status is not `active` |
| `{allowed, company_id, company_name, available, limit_daily_left, limit_monthly_left}` | resolved; `allowed` = `available >= amount` (or `available > 0` when no amount given) |

**The two decline bodies are NARROW** — no `company_id`, no `available`, no limit
fields. Do not read those keys without checking `reason` first.

500 body: `{allowed:false, reason:"service_error"}`.

`check` is advisory only. It takes no locks and reserves nothing; between a
`check` and an `authorize` another order can consume the headroom. Never treat an
`allowed:true` as a promise that `authorize` will approve.

### `/internal/credit/authorize` — reserve credit for an order

Request: `{ brand, order_id, order_number?, phone, amount: integer >= 1, expires_at? }`
(`expires_at` is an ISO date-time; default is now + 24h. Pass `later_time + 24h`
for scheduled orders, or the hold reaper will expire it before the order runs.)

| 200 body | meaning |
|---|---|
| `{approved:true, hold_id, company_id}` | reserved (or an idempotent replay of the same order at the same amount) |
| `{approved:false, reason:"unknown_phone"}` | not a credit customer |
| `{approved:false, reason:"suspended"}` | company not `active` |
| `{approved:false, reason:"limit_total"}` | total ceiling |
| `{approved:false, reason:"limit_daily"}` | today's ceiling |
| `{approved:false, reason:"limit_monthly"}` | this month's ceiling |
| `{approved:false, reason:"amount_mismatch"}` | **this order already has a hold for a DIFFERENT amount — call `/amend`** |
| `{approved:false, reason:"service_error"}` | see below |

500 body: `{approved:false, reason:"service_error"}`.

`service_error` in a 200 body covers three distinct situations, all of them
"do not retry blindly":
1. a genuine internal failure (DB error), *and*
2. re-authorizing an order whose hold was **voided or expired** — a caller bug: a
   cancelled order must be re-placed under a **new** `order_id`, *and*
3. the phone now resolves to a **different company** than the one owning the
   existing hold.

### `/internal/credit/amend` — same order, new total

Request: `{ brand, order_id, amount: integer >= 1 }` — `amount` is the **new
total**, not a delta.

This is the operation for Laravel's *resend-composition* flow, where an operator
edits an existing order and the total changes. `/authorize` cannot express it (it
is idempotent on the order id and now answers `amount_mismatch`), and
void-then-re-authorize cannot either (re-authorizing a voided order id is
rejected by design).

| 200 body | meaning |
|---|---|
| `{ok:true}` | amended, or a replay (the hold already carries exactly this amount) |
| `{ok:false, reason:"not_found"}` | no hold for this `(brand, order_id)` |
| `{ok:false, state:"captured"\|"voided"\|"expired", reason:"wrong_state"}` | only a `held` hold can be amended; a captured order is corrected with `/refund` |
| `{ok:false, reason:"bad_amount"}` | not a positive integer |
| `{ok:false, reason:"suspended"}` | company is not `active` and the amend would **increase** the amount. Refuse the composition change; do not retry. Amending **down** stays allowed for a suspended company |
| `{ok:false, reason:"limit_total"\|"limit_daily"\|"limit_monthly"}` | the **increase** does not fit. Nothing changed — the whole amend rolled back |
| `{ok:false, reason:"service_error"}` | internal failure |

500 body: `{ok:false, reason:"service_error"}`.

Notes that matter for the caller:

- Repeated amends are legal, and each writes its own `amend` ledger entry
  (`amount` = the delta, `meta` = `{prev_amount, new_amount}`). Retrying the same
  amend is safe because an amend to the amount already held is a no-op success.
- Only the **increase** is limit-checked. Shrinking always succeeds.
- The delta is booked against the **hold's own period keys**, not today's — so an
  order placed yesterday and amended after midnight still counts against
  yesterday. (Charging today would leave today permanently inflated when the
  order is later amended down, since the release reverses the hold's own keys.)

**Which operation for which Laravel flow:**

| what happened | call |
|---|---|
| composition changed, **same** order id | `/amend` |
| order cancelled, then re-created as a **new** order | `/void` on the old id, `/authorize` with the **new** id |
| order cancelled outright | `/void` |
| order handed to the customer | `/capture` |
| money given back after capture | `/refund` |

### `/internal/credit/capture` and `/internal/credit/void`

Request: `{ brand, order_id }`

| 200 body | meaning |
|---|---|
| `{ok:true}` | done, or an idempotent replay (already captured / already voided) |
| `{ok:false, reason:"not_found"}` | no such hold |
| `{ok:false, state:<state>, reason:"wrong_state"}` | capture on a voided/expired hold, or void on a captured one (use `/refund`) |
| `{ok:false, reason:"service_error"}` | internal failure |

500 body: `{ok:false, reason:"service_error"}`.

### `/internal/credit/refund`

Request: `{ brand, order_id, amount?: integer >= 1 }` — omit `amount` for a full
refund; a partial amount is capped at the captured amount.

| 200 body | meaning |
|---|---|
| `{ok:true}` | refunded, or a replay of the **same amount** |
| `{ok:false, reason:"bad_amount"}` | zero, negative or fractional — rejected before touching the DB |
| `{ok:false, reason:"not_found"}` | no such hold |
| `{ok:false, state:"held", reason:"wrong_state"}` | not captured yet — `/void` instead |
| `{ok:false, reason:"already_refunded_different_amount"}` | a refund exists for a different amount. **The schema stores one refund per order** — a second, differently-sized partial refund cannot be represented and is refused rather than silently swallowed. Needs a human |
| `{ok:false, reason:"service_error"}` | internal failure |

500 body: `{ok:false, reason:"service_error"}`.

### `/internal/credit/history` — read-only ledger

Request: `{ company_id?, brand?, order_id?, limit?: 1..1000 (default 100), offset?: >= 0 }`
Response: `{data: [...credit_entries rows]}`, newest first. 500: `{ok:false, reason:"service_error"}`.

---

## 3. Rules for Plan 2 (admin UI, workers)

**Use `getCreditDb()`. Never the request context's drizzle handle.** The context
handle is `drizzle-orm/node-postgres`, whose `.execute()` resolves to a
`{rows, rowCount}` object; every raw query in `service.ts` treats the result as an
array. Passing the wrong handle does not throw a clear error — it produces
`TypeError`s that the service's own `catch` blocks flatten into `service_error`,
i.e. money operations that silently fail.

**Money moves through `applyPayment` / `applyAdjustment` only.** No raw
`UPDATE credit_accounts` from admin code: the balance and its ledger entry must
land in the same transaction or reconciliation starts alerting.

- `applyPayment(db, company_id, amount, {doc_number, doc_date, note, created_by})`
  — `amount > 0` reduces debt. **Always pass `doc_number`**: it is the
  idempotency key (unique per company), and a repeat returns
  `{ok:true, reason:"duplicate_doc"}` with **no second debit**. A `null`
  `doc_number` is accepted for legacy/manual entries and has **no replay
  protection whatsoever** — a double-submitted form debits twice.
- `applyAdjustment(db, company_id, amount, {reason, created_by})` — manual
  correction. **Sign: positive reduces debt, negative increases it** (same
  direction as a payment). `amount` must be a non-zero integer and `reason` must
  be non-empty; both are rejected as `bad_amount` / `bad_reason`. Unknown company
  → `{ok:false, reason:"not_found"}`.

**Invalidate the phone cache on every company write.** Call
`invalidateCreditCompanyCache(redis, phones)` after any change to
`credit_companies` (status, limits) or `credit_company_phones` (add, deactivate,
renumber) — passing **every** phone affected.

The case that is easy to miss is **adding a phone**. Negative lookups are cached
too, so a number that was queried even once before being added stays cached as
"no company" for up to 60s, and the brand-new customer is hard-declined at
checkout (`unknown_phone`). That is a false *decline*, not merely a stale approve.

Invalidation is best-effort and bounded (~250ms): a resolved promise is **not**
proof the key is gone. The 60s TTL is the real backstop.

**Workers have no cache client.** `creditRedis` is `null` outside the process that
called `setCreditRedis`, so a worker's reads bypass the cache — but its **writes**
still need to invalidate the cache the API process is using. Workers must call
`invalidateCreditCompanyCache` with their own Redis client.

## 4. Operational notes

**Socket permissions at Plan 3.** Laravel runs as `php-fpm`, so the run directory
needs `chgrp <php-fpm group> /home/davr/managers/run` and `chmod 2750` on it. The
**setgid bit (the leading 2) is the point**: the socket is recreated on every
process restart, and setgid makes each new socket inherit the directory's group
automatically. Without it, the next restart silently produces a socket the web
user cannot open — an outage that begins at a deploy with no code change to blame.

**`credit_companies.overdue` enforces nothing today.** It is a flag Plan 2 can
set and display; no code path reads it. Blocking overdue customers means
suspending them (`status`) or zeroing a limit.

**Reconciliation is report-only and never auto-fixes.** It runs nightly (03:30),
re-derives `reserved`, `posted` and every period counter from holds and entries,
and alerts on drift. Period drift is reported **one-sided** — only when the stored
counter is *higher* than derived, i.e. a customer is being blocked by spend that
no longer exists — because period reversals floor at zero and can legitimately
leave the counter below the derived value.

**The hold reaper** runs every 15 minutes and expires `held` holds past
`expires_at`, releasing their reserve. Every reap is alerted: a hold reaching its
expiry means an order was authorized and then never captured or voided, which is
a broken chain in Laravel, not routine cleanup.
