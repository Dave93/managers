import { z } from "zod";
import { iikoCachierReportInputSchema } from "../z_objects";
import path from "path";
import { RedisClientType } from "..";
import dayjs from "dayjs";

export const getIikoCachierReport = async (
  input: z.infer<typeof iikoCachierReportInputSchema>,
  redis: RedisClientType
): Promise<{
  cashIds: string[];
  totalSum: number;
}> => {
  const response = await fetch(
    `https://les-ailes-co-co.iiko.it/resto/api/auth?login=${Bun.env.IIKO_LOGIN}&pass=${Bun.env.IIKO_PASS}`,
    {
      method: "GET",
    }
  );
  const token = await response.text();

  const cachierReport = await fetch(
    `https://les-ailes-co-co.iiko.it/resto/api/v2/cashshifts/list?openDateFrom=${dayjs(
      input.date
    ).format("YYYY-MM-DD")}&openDateTo=${dayjs(input.date).format(
      "YYYY-MM-DD"
    )}&groupId=${input.groupId}&status=CLOSED&key=${token}`
  );

  const reportBody = await cachierReport.json();
  console.log("reportBody", reportBody);
  let totalSum = reportBody.reduce((acc: number, item: any) => {
    return acc + item.payOrders;
  }, 0);
  return {
    cashIds: reportBody.map((item: any) => item.id),
    totalSum,
  };
};
