// Два подключения к Workly: у каждой организации свой набор ключей.
export type ConnKey = "LES" | "CHOPAR";

export interface WorklyCreds {
  key: ConnKey;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
}

export interface WorklyLocationRef {
  id: number;
  title: string;
}

export interface WorklyEmployee {
  id: number;
  first_name: string;
  last_name: string;
  patronymic: string;
  tab_number: string;
  start_date: string;
  birth_date?: string | null;
  positions: { id: number; title: string }[];
  locations: WorklyLocationRef[];
}

export interface WorklyDismissed {
  id: number;
  first_name: string;
  last_name: string;
  patronymic: string;
  tab_number: string;
  start_date: string;
  end_date: string;
}

export interface WorklyLocation {
  id: number;
  title: string;
}

// Табель Т-12: день графика сотрудника.
export interface T12Day {
  report_date: string;
  is_work_day: boolean;
  is_holiday: boolean;
  work_time: string | null;
}

export interface T12Item {
  employee_id: number;
  report: { days: T12Day[] } | null;
}

// Отчёт об опозданиях: плановый день и фактические отметки.
export interface LateInItem {
  employee: { id: number };
  scheduled: { report_date: string };
  actual: { first_in: string | null; last_out: string | null; late_in: string | null };
}

// Отчёт о прогулах: плановый день, timeoff_id — если отсутствие оформлено.
export interface AbsenceItem {
  employee: { id: number };
  scheduled: { report_date: string; is_work_day?: boolean; timeoff_id: number | null };
}

// Действие пользователя в Workly (/v1/user-activities). Клиент отдаёт только номер и название:
// в записи есть имена и текст сообщения, а они нужны не для сверки, а лишь попали бы в логи.
export interface ActivityItem {
  id: number;
  action_name: string;
}
