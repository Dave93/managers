import { expect, it } from "bun:test";
import type { TgAttendance, TgAttendanceDay } from "@backend/modules/kpi/tg-app/types";
import { attendanceView } from "../src/view/attendance";

const day = (o: Partial<TgAttendanceDay> & { day: string }): TgAttendanceDay => ({ check_in: null, check_out: null, late_minutes: 0, absent: false, ...o });
const month = (days: TgAttendanceDay[], o: Partial<TgAttendance> = {}): TgAttendance => ({ month: "2026-11", prev: "2026-10", next: null, days, ...o });

it("приход и уход по Ташкенту, опоздание только когда больше нуля", () => {
  const vm = attendanceView(
    month([
      day({ day: "2026-11-04", check_in: "2026-11-04T04:07:00.000Z", check_out: "2026-11-04T13:00:00.000Z", late_minutes: 12 }),
      day({ day: "2026-11-03", check_in: "2026-11-03T03:55:00.000Z", check_out: "2026-11-03T13:02:00.000Z", late_minutes: 0 }),
    ]),
    "ru",
  );
  expect(vm.title).toBe("Моя посещаемость");
  expect(vm.month).toBe("Ноябрь 2026");
  expect(vm.empty).toBeNull();
  expect(vm.rows).toEqual([
    { day: "4 ноября", absent: null, times: { in: "09:07", out: "18:00" }, late: "опоздание 12 мин" },
    { day: "3 ноября", absent: null, times: { in: "08:55", out: "18:02" }, late: null },
  ]);
});

it("«не вышел» только при absent = true: ни времён, ни опоздания, даже если они лежат в данных", () => {
  const vm = attendanceView(month([day({ day: "2026-11-05", absent: true, check_in: "2026-11-05T04:00:00.000Z", late_minutes: 30 })]), "ru");
  expect(vm.rows).toEqual([{ day: "5 ноября", absent: "не вышел", times: null, late: null }]);
});

it("приход без ухода — «нет отметки»; уход без прихода так же; отметок нет совсем — прочерки", () => {
  const vm = attendanceView(
    month([
      day({ day: "2026-11-06", check_in: "2026-11-06T04:00:00.000Z" }),
      day({ day: "2026-11-07", check_out: "2026-11-07T13:00:00.000Z" }),
      day({ day: "2026-11-08" }),
    ]),
    "ru",
  );
  expect(vm.rows.map((r) => r.times)).toEqual([
    { in: "09:00", out: "нет отметки" },
    { in: "нет отметки", out: "18:00" },
    { in: "—", out: "—" },
  ]);
});

it("ночной уход: 20:30 UTC это 01:30 по Ташкенту, день остаётся прежним", () => {
  const vm = attendanceView(
    month([day({ day: "2026-10-31", check_in: "2026-10-31T10:00:00.000Z", check_out: "2026-10-31T20:30:00.000Z" })], { month: "2026-10" }),
    "ru",
  );
  expect(vm.rows[0]).toEqual({ day: "31 октября", absent: null, times: { in: "15:00", out: "01:30" }, late: null });
});

it("пустой месяц: «Данных за месяц нет», переключатель остаётся; без соседей ссылок нет", () => {
  const vm = attendanceView(month([], { prev: "2026-08", next: "2026-12" }), "ru");
  expect([vm.empty, vm.rows]).toEqual(["Данных за месяц нет", []]);
  expect(vm.prev).toEqual({ label: "Август", hash: "#/attendance/2026-08", aria: "Предыдущий месяц" });
  expect(vm.next).toEqual({ label: "Декабрь", hash: "#/attendance/2026-12", aria: "Следующий месяц" });
  const none = attendanceView(month([day({ day: "2026-11-03" })], { prev: null }), "ru");
  expect([none.empty, none.prev, none.next]).toEqual([null, null, null]);
});

it("по-узбекски", () => {
  const vm = attendanceView(
    month([
      day({ day: "2026-11-04", check_in: "2026-11-04T04:07:00.000Z", check_out: "2026-11-04T13:00:00.000Z", late_minutes: 12 }),
      day({ day: "2026-11-05", absent: true }),
    ]),
    "uz",
  );
  expect([vm.title, vm.month]).toEqual(["Mening davomatim", "Noyabr 2026"]);
  expect(vm.rows.map((r) => [r.day, r.absent, r.late])).toEqual([["4-noyabr", null, "12 daqiqa kechikdi"], ["5-noyabr", "ishga chiqmadi", null]]);
  expect(attendanceView(month([]), "uz").empty).toBe("Oy uchun maʼlumot yoʻq");
});
