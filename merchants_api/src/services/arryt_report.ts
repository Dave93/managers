import { z } from "zod";
import {
  arrytReportInputSchema,
  expressReportInputSchema,
  iikoCachierReportInputSchema,
} from "../z_objects";
import path from "path";
import { RedisClientType } from "..";
import dayjs from "dayjs";

export const getArrytReport = async (
  input: z.infer<typeof arrytReportInputSchema>,
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
  console.log('arryt_input data', input)
  const credentials = allCredentials.filter(
    (credential) =>
      credential.model_id == input.terminal_id &&
      credential.model == "terminals"
  );

  const terminals = JSON.parse(
    (await redis.get(`${Bun.env.PROJECT_PREFIX}terminals`)) ?? "[]"
  ) as any[];

  const terminal = terminals.find(
    (terminal) => terminal.id === input.terminal_id
  );

  const organizationCredentials = allCredentials.filter(
    (credential) =>
      credential.model_id === terminal.organization_id &&
      credential.model === "organization"
  );

  const organizationArrytToken = organizationCredentials.find(
    (credential) => credential.type === "arryt_token"
  )?.key;

  const iikoId = credentials.find(
    (credential) => credential.type === "iiko_id"
  )?.key;
  console.log('credentials', credentials);
  const response = await fetch(Bun.env.ARRYT_WITHDRAW_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${organizationArrytToken}`,
    },
    body: JSON.stringify({
      terminal_id: iikoId,
      date_from: dayjs(input.date)
        .hour(workStartTime)
        .minute(0)
        .second(0)
        .toISOString(),
      date_to: input.time
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
  });

  const result = await response.json();
  return result as {
    customerPrice: number;
    withdraws: {
      name: string;
      amount: number;
    }[];
  };
};
