import { ctx } from "@merchants/src/context";
import dayjs from "dayjs";
import { Elysia, t } from "elysia";

export const expressController = new Elysia({
    name: '@api/express'
})
    .use(ctx)
    .post('/express', async ({ body: {
        date, terminal_id, time, organization_code
    }, set, drizzle, cacheController }) => {
        const settings = await cacheController.getCachedSettings({});
        const workStartTime = settings.find(
            (s: any) => s.key == "main.workStartTime"
        )?.value;
        const workEndTime = settings.find(
            (s: any) => s.key == "main.workEndTime"
        )?.value;

        if (!workStartTime || !workEndTime) {
            set.status = 400;
            return {
                message: "Work start time or work end time not found",
            };
        }

        const allCredentials = await cacheController.getCachedCredentials({});
        const credentials = allCredentials.filter(
            (credential) =>
                credential.model_id == terminal_id &&
                credential.model == "terminals"
        );

        const iikoId = credentials.find(
            (credential) => credential.type === "iiko_id"
        )?.key;

        if (!iikoId) {
            set.status = 400;
            return {
                message: "Iiko id not found",
            };
        }

        console.log('express request', JSON.stringify({
            iiko_id: iikoId,
            dateFrom: dayjs(date)
                .hour(parseInt(workStartTime))
                .minute(0)
                .second(0)
                .toISOString(),
            dateTo: time
                ? dayjs(date)
                    .hour(+time.split(":")[0])
                    .minute(+time.split(":")[1])
                    .second(0)
                    .toISOString()
                : dayjs(date)
                    .add(1, "day")
                    .hour(parseInt(workEndTime))
                    .minute(0)
                    .second(0)
                    .toISOString(),
        }))

        const response = await fetch(
            `${Bun.env["ECOMMERCE_" + organization_code.toUpperCase() + "_URL"]}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${Bun.env["ECOMMERCE_TOKEN"]}`,
                },
                body: JSON.stringify({
                    iiko_id: iikoId,
                    dateFrom: dayjs(date)
                        .hour(parseInt(workStartTime))
                        .minute(0)
                        .second(0)
                        .toISOString(),
                    dateTo: time
                        ? dayjs(date)
                            .hour(+time.split(":")[0])
                            .minute(+time.split(":")[1])
                            .second(0)
                            .toISOString()
                        : dayjs(date)
                            .add(1, "day")
                            .hour(parseInt(workEndTime))
                            .minute(0)
                            .second(0)
                            .toISOString(),
                }),
            }
        );


        const result = await response.json();

        return result.result.data;
    }, {
        body: t.Object({
            date: t.String(),
            terminal_id: t.String(),
            time: t.Optional(t.Nullable(t.String())),
            organization_code: t.String()
        })
    })