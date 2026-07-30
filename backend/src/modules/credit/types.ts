export type CreditBrand = "chopar" | "les";
export type DeclineReason =
  | "unknown_phone" | "suspended"
  | "limit_daily" | "limit_monthly" | "limit_total"
  | "service_error";

export type AuthorizeInput = {
  brand: CreditBrand;
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
