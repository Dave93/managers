export type CashierKpi = {
  cashier_id: string;
  cashier_name: string;
  cashier_code: string | null;
  terminal_name: string | null;
  shifts: number;
  orders: number;
  revenue: number;
  hours: number;
  avg_check: number;
  orders_per_hour: number;
  revenue_per_hour: number;
  prev: {
    shifts: number;
    orders: number;
    revenue: number;
    hours: number;
    avg_check: number;
    orders_per_hour: number;
    revenue_per_hour: number;
  } | null;
};

export type CashierKpiResponse = {
  from: string;
  to: string;
  prev_from: string;
  prev_to: string;
  cashiers: CashierKpi[];
};

export type CashierDailyPoint = {
  day: string;
  revenue: number;
  orders: number;
  active_cashiers: number;
  revenue_per_cashier: number;
  cashier_revenue: number | null;
  cashier_orders: number | null;
};

export type CashierDailyResponse = {
  days: CashierDailyPoint[];
};
