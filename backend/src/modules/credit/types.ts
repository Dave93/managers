export type CreditBrand = "chopar" | "les";
export type DeclineReason =
  | "unknown_phone" | "suspended"
  | "limit_daily" | "limit_monthly" | "limit_total"
  // replay of a (brand, order_id) that already holds a DIFFERENT amount. Laravel's
  // resend-composition flow reuses the same order id with a new total, so this is
  // the signal "you meant /amend, not /authorize" — never a service failure and
  // never a retry candidate.
  | "amount_mismatch"
  | "service_error";

export type AuthorizeInput = {
  brand: CreditBrand;
  // Laravel's `orders.id` as a string — the identity that ties a hold to an order
  // for its whole life. Never the order NUMBER (chopar and les share a CRM
  // number space and collide), never a hashid.
  order_id: string;
  order_number?: string;
  phone: string;
  amount: number; // tiyins, > 0
  expires_at?: Date; // default now + 24h; Laravel passes later_time+24h for scheduled orders
};

export type AuthorizeResult =
  | { approved: true; hold_id: string; company_id: string }
  | { approved: false; reason: DeclineReason };

export type OpResult = { ok: boolean; state?: string; reason?: string };
