export type CashShiftLite = {
  id: string;
  terminal_id: string | null;
  terminal_name: string | null;
  iiko_group_id: string | null;
  iiko_group_name: string | null;
  cash_reg_number: number;
  cash_register_name: string | null;
  business_date: string;
  open_at: string;
  close_at: string | null;
  status: string;
  pay_orders: number;
};

export type CashShiftCashier = {
  cashier_id: string;
  cashier_name: string;
  cashier_code: string | null;
  orders_count: number;
  revenue: number;
};

export type CashShiftFull = CashShiftLite & {
  session_number: number;
  responsible_user_name: string | null;
  manager_name: string | null;
  sales_cash: number;
  sales_card: number;
  sales_credit: number;
  pay_in: number;
  pay_out: number;
  cash_diff: number;
  cashiers: CashShiftCashier[];
};
