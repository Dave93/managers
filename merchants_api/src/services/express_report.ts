import { z } from "zod";
import {
  expressReportInputSchema,
  iikoCachierReportInputSchema,
} from "../z_objects";
import path from "path";
import { RedisClientType } from "..";
import dayjs from "dayjs";

export const getExpressReport = async (
  input: z.infer<typeof expressReportInputSchema>,
  redis: RedisClientType
) => {
  const settings = await redis.get(`${Bun.env.PROJECT_PREFIX}settings`);
  const settingsJson = JSON.parse(settings!);
  const workStartTime = settingsJson.find(
    (s: any) => s.key == "main.workStartTime"
  ).value;
  const workEndTime = settingsJson.find(
    (s: any) => s.key == "main.workEndTime"
  ).value;

  const allCredentials = JSON.parse(
    (await redis.get(`${Bun.env.PROJECT_PREFIX}credentials`)) ?? "[]"
  ) as any[];
  const credentials = allCredentials.filter(
    (credential) =>
      credential.model_id === input.terminal_id &&
      credential.model === "terminals"
  );

  const iikoId = credentials.find(
    (credential) => credential.type === "iiko_id"
  )?.key;
  const response = await fetch(
    `${Bun.env["ECOMMERCE_" + input.organization_code.toUpperCase() + "_URL"]}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Bun.env["ECOMMERCE_TOKEN"]}`,
      },
      body: JSON.stringify({
        iiko_id: iikoId,
        dateFrom: dayjs(input.date)
          .hour(workStartTime)
          .minute(0)
          .second(0)
          .toISOString(),
        dateTo: input.time
          ? dayjs(input.date)
            .hour(+input.time.split(":")[0])
            .minute(+input.time.split(":")[1])
            .second(0)
            .toISOString()
          : dayjs(input.date)
            .add(1, "day")
            .hour(workEndTime)
            .minute(0)
            .second(0)
            .toISOString(),
      }),
    }
  );

  const result = await response.json();

  return result.result.data;
};
