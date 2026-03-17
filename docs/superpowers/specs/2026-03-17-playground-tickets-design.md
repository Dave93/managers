# Playground Tickets — Barcode System for Children's Playground

**Date:** 2026-03-17
**Status:** Approved

## Overview

System for generating, printing, and validating QR-code tickets for a children's playground. Tickets are generated based on order amount at iiko POS terminals, printed on receipts, and validated via camera scanning in the admin web application.

**Business rule:** 1 child per 50,000 sum. Ticket valid until end of day of purchase (Asia/Tashkent timezone). Single-use (scanned once, fully redeemed).

## Architecture

Three components:
1. **Backend API** (managers) — ticket generation, validation, listing
2. **iiko Plugin** (new_webserver) — calls API on order bill, prints QR on receipt
3. **Admin Frontend** (managers/admin) — QR scanning page + ticket list page

## 1. Database Schema

New table `playground_tickets` in PostgreSQL (Drizzle ORM):

```
playground_tickets
├── id              UUID PRIMARY KEY (DEFAULT gen_random_uuid())
├── terminal_id     UUID NOT NULL (FK → terminals.id)
├── organization_id UUID NOT NULL (FK → organization.id)
├── order_number    VARCHAR NOT NULL
├── order_amount    INTEGER NOT NULL (sum in base currency units)
├── children_count  INTEGER NOT NULL (order_amount / 50000)
├── is_used         BOOLEAN NOT NULL DEFAULT false
├── used_at         TIMESTAMP WITH TIMEZONE NULL (mode: "string")
├── created_at      TIMESTAMP WITH TIMEZONE NOT NULL DEFAULT now() (mode: "string")
├── updated_at      TIMESTAMP WITH TIMEZONE NOT NULL DEFAULT now() (mode: "string")
```

Constraints:
- `UNIQUE(terminal_id, order_number)` — idempotency guard against HttpHelper retries

Indexes:
- `idx_playground_tickets_terminal_id` on `terminal_id`
- `idx_playground_tickets_created_at` on `created_at`
- `idx_playground_tickets_organization_id` on `organization_id`

Migration: Use `drizzle-kit generate` after adding schema definition, then `drizzle-kit migrate`.

## 2. Backend API

New module: `/backend/src/modules/playground_tickets/`

Structure:
```
playground_tickets/
├── controller.ts    — route handlers
├── service.ts       — business logic
└── dto/
    └── playground_tickets.dto.ts
```

### Auth for generate endpoint

Uses inline Bearer token validation (same pattern as stoplist webhook in `/backend/src/modules/stoplist/controller.ts`):
- Extract `Authorization: Bearer {token}` from headers
- Look up token in cached `api_tokens`
- Validate `active` status
- Resolve `organization_id` from token record

### Endpoints

#### POST /api/playground_tickets/generate
- **Auth:** Bearer token (inline, stoplist pattern) → resolves `organization_id`
- **Body:** `{ terminal_id: string, order_number: string, order_amount: number }`
- **Logic:**
  - `children_count = Math.floor(order_amount / 50000)`
  - If `children_count < 1` → 400 `{ message: "Order amount too low for playground ticket" }`
  - Insert into `playground_tickets` with `ON CONFLICT(terminal_id, order_number) DO NOTHING`
  - If conflict (retry) → return existing ticket
  - Return `{ ticket_id, children_count, qr_data: "PLAYGROUND:{ticket_id}" }`

#### POST /api/playground_tickets/validate
- **Auth:** Session cookie + permission `playground_tickets.validate`
- **Body:** `{ qr_data: string }`
- **Logic:**
  - Parse `ticket_id` from `"PLAYGROUND:{ticket_id}"` format
  - Find ticket in DB, scoped by user's `organization_id`
  - Not found → 404 `{ message: "Ticket not found" }`
  - `is_used == true` → 400 `{ message: "Ticket already used", used_at }`
  - `created_at` not today (Asia/Tashkent) → 400 `{ message: "Ticket expired" }`
  - OK → set `is_used = true, used_at = now(), updated_at = now()`
  - Return `{ ticket_id, children_count, order_number, order_amount, terminal_name }`

#### GET /api/playground_tickets
- **Auth:** Session cookie + permission `playground_tickets.list`
- **Query:** Standard `limit, offset, sort, filters, fields`
- **Scoping:** Filter by user's `organization_id`
- **Filters:** date range, terminal_id, is_used
- **Returns:** `{ total, data: [...] }` with terminal name join

### Error response format
All errors return `{ message: string }` (consistent with existing controllers).

## 3. iiko Plugin (C#)

### Configuration (app.config)
- `ManagersApiUrl` — base URL of managers API
- `ManagersApiToken` — token from `api_tokens` table
- `PlaygroundMinAmount` — minimum order amount for ticket (default: 50000)

Note: These are new settings separate from existing `ApiUrl`/`ApiToken` (which are for Tablo service).

### Integration point
Add playground ticket logic as a separate method within the existing `BeforeOrderBill` handler in `CustomWebserver.cs`. Must execute **after** the existing Yandex payment verification logic to avoid interference. Wrapped in try-catch to never block the sale.

### Flow
1. Get order amount from the bill
2. If amount < `PlaygroundMinAmount` → skip
3. Get `terminal_id` via `PluginContext.Operations.GetHostTerminalsGroup().Id`
4. Call `POST /api/playground_tickets/generate` via `HttpHelper`
   - Headers: `Authorization: Bearer {ManagersApiToken}`
   - Body: `{ terminal_id, order_number, order_amount }`
   - HttpHelper's built-in retry + `X-Idempotency-Key` handled by UNIQUE constraint on server
5. On success, extend receipt with:
   - Separator line "═══════════════════════"
   - Title "БИЛЕТ ДЕТСКОЙ ПЛОЩАДКИ" (bold)
   - Text "Кол-во детей: {children_count}"
   - Text "Действителен до: {end of today}"
   - QR code with data "PLAYGROUND:{ticket_id}"
   - Separator line "═══════════════════════"
6. On API error → log error via `PluginContext.Log`, proceed with receipt without ticket

### QR Code in receipt
Use iiko Bill Cheque extension API. The `BillChequeExtender` pattern from OFD plugin (`C:\projects\ofd\Plugin`) uses XElement markup. For QR code, use the iiko `<qrcode>` XElement tag within the bill extension. Research the exact iiko Resto.Front.Api V8 documentation for `IOperationService.AddNotificationToOrder` or `BeforeDoCheque` extension points to confirm XML schema.

## 4. Admin Frontend (Next.js)

### Scan page: `/[locale]/admin/playground/scan`
- Camera-based QR scanner (library: `html5-qrcode` — mature, works on mobile)
- Auto-detect `PLAYGROUND:` prefix
- Call `POST /api/playground_tickets/validate` on scan
- Results:
  - **Valid** → green block: children count, order number, terminal
  - **Already used** → red block: "Already used" + used_at timestamp
  - **Expired** → red block: "Ticket expired"
  - **Not found** → red block: "Ticket not found"
  - **Not playground QR** → yellow block: "Not a playground ticket"
- "Scan another" button to reset
- **Fallback:** manual ticket ID text input field (for cases where camera/HTTPS is unavailable)

### HTTPS note
Camera access (`getUserMedia`) requires HTTPS in modern browsers. Ensure the admin app is served over HTTPS, or use the manual input fallback on HTTP.

### List page: `/[locale]/admin/playground/list`
- TanStack React Table (standard project pattern)
- Filters: date range, terminal (dropdown), status (used/unused)
- Columns: ticket ID (first 8 chars of UUID), terminal, order number, amount, children count, status, created_at, used_at

### Navigation
- New admin sidebar item: "Детская площадка" with sub-items "Сканирование" and "Список билетов"
- Permissions: `playground_tickets.list`, `playground_tickets.validate`

### Localization
- Add keys to `messages/` for all 4 locales (ru, en, uz-Latn, uz-Cyrl)

## 5. Error Handling

| Scenario | Behavior |
|----------|----------|
| API unreachable from plugin | Log error, print receipt without ticket |
| Invalid token | 401 `{ message: "Unauthorized" }`, plugin logs error |
| Order amount < 50000 | Plugin skips ticket generation silently |
| Duplicate order_number + terminal_id (retry) | Return existing ticket (idempotent) |
| QR scan of non-playground code | Yellow warning in UI |
| Network error during validate | Show error in UI, allow retry |

## 6. Security

- Generate endpoint authenticated via `api_tokens` (organization-scoped)
- Validate/list endpoints authenticated via session cookies + permissions, scoped by organization
- Ticket IDs are UUIDs — not guessable
- QR data prefixed with `PLAYGROUND:` to namespace from other QR codes
- All queries scoped by `organization_id` for multi-tenant isolation
