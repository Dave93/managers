import { z } from "zod";
import { clickReportInputSchema } from "../z_objects";
import WebSocket from "ws";
import dayjs from "dayjs";
import { RedisClientType } from "..";

export const getClickReport = async (
  input: z.infer<typeof clickReportInputSchema>,
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

  let globalMessage = "";
  let isMessageFinished = false;

  const result = await new Promise((resolve, reject) => {
    let totalSum = 0;
    // @ts-ignore
    const ws = new WebSocket(Bun.env.CLICK_WS_URL!, {
      maxPayload: 104857600,
    });
    let sesskey = "";
    const serviceIds = input.serviceIds;
    ws.on("open", () => {
      console.log("Connected to server");

      ws.send(
        JSON.stringify({
          method: "api.login",
          parameters: {
            login: Bun.env.CLICK_LOGIN,
            auth_pass: Bun.env.CLICK_PASSWORD,
            auth_ip: Bun.env.CLICK_AUTH_IP,
          },
        })
      );
    });

    ws.on("message", (message: string) => {

      if (Buffer.isBuffer(message)) {
        message = message.toString();
      }

      try {
        if (isMessageFinished) {
          globalMessage = message;
        } else {
            globalMessage += message;
        }
        JSON.parse(globalMessage);
        isMessageFinished = true;
      } catch (e) {
        isMessageFinished = false;
      }
      if (isMessageFinished) {
        let data = JSON.parse(globalMessage);
        globalMessage = "";
        if (data.method == "api.login") {
          if (data.data[0][0].result == "FAILED") {
            ws.close();
            return reject(data.data[0][0].error_note);
          }

          sesskey = data.data[0][0].seskey;

          let firstServiceId = serviceIds[0];
          // for (let serviceId of input.serviceIds) {
          ws.send(
              JSON.stringify({
                method: "api.get.user.report",
                parameters: {
                  session_key: sesskey,
                  report_name: "payments",
                  service_id: firstServiceId,
                  cashbox_id: null,
                  cntrg_param1: null,
                  cntrg_param2: null,
                  click_paydoc_id: null,
                  date_from:
                      dayjs(input.date).format("YYYY-MM-DD") +
                      ` ${workStartTime}:00:00`,
                  date_to: input.time
                      ? dayjs(input.date).format("YYYY-MM-DD") + ` ${input.time}:00`
                      : dayjs(input.date).add(1, "day").format("YYYY-MM-DD") +
                      ` ${workEndTime}:00:00`,
                  page_size: 500,
                  page_number: 1,
                  merchant_id: null,
                  phone_num: null,
                  status: "S",
                },
              })
          );
          // }
        }

        if (data.method == "api.get.user.report") {
          const rows = data.data[0];
          if (rows.length > 0) {
            totalSum += data.data[1][0].total;
          }
          let firstServiceId = serviceIds.shift();
          firstServiceId = serviceIds[0];
          if (firstServiceId) {
            ws.send(
                JSON.stringify({
                  method: "api.get.user.report",
                  parameters: {
                    session_key: sesskey,
                    report_name: "payments",
                    service_id: firstServiceId,
                    cashbox_id: null,
                    cntrg_param1: null,
                    cntrg_param2: null,
                    click_paydoc_id: null,
                    date_from:
                        dayjs(input.date).format("YYYY-MM-DD") +
                        ` ${workStartTime}:00:00`,
                    date_to:
                        dayjs(input.date).add(1, "day").format("YYYY-MM-DD") +
                        ` ${workEndTime}:00:00`,
                    page_size: 500,
                    page_number: 1,
                    merchant_id: null,
                    phone_num: null,
                    status: "S",
                  },
                })
            );
          } else {
            ws.close();
            return resolve(totalSum);
          }
        }
      }
    });

    ws.on("close", () => {
      console.log("Disconnected from server");
    });
  });
  return result;
};
