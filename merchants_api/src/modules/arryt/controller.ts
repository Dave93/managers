import { ctx } from "@merchants/src/context";
import dayjs from "dayjs";
import { Elysia, t } from "elysia";

export const arrytController = new Elysia({
    name: '@api/arryt'
})
    .use(ctx)
    .post('/arryt', async ({ body: {
        date, terminal_id, time
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


        const terminals = await cacheController.getCachedTerminals({});
        const terminal = terminals.find(
            (terminal) => terminal.id === terminal_id
        );

        if (!terminal) {
            set.status = 400;
            return {
                message: "Terminal not found",
            };
        }

        const organizationCredentials = allCredentials.filter(
            (credential) =>
                credential.model_id === terminal.organization_id &&
                credential.model === "organization"
        );

        const organizationArrytToken = organizationCredentials.find(
            (credential) => credential.type === "arryt_token"
        )?.key;

        if (!organizationArrytToken) {
            set.status = 400;
            return {
                message: "Organization arryt token not found",
            };
        }

        const iikoId = credentials.find(
            (credential) => credential.type === "iiko_id"
        )?.key;

        if (!iikoId) {
            set.status = 400;
            return {
                message: "Iiko id not found",
            };
        }


        const response = await fetch(process.env.ARRYT_WITHDRAW_API!, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${organizationArrytToken}`,
            },
            body: JSON.stringify({
                terminal_id: iikoId,
                date_from: dayjs(date)
                    .hour(parseInt(workStartTime))
                    .minute(0)
                    .second(0)
                    .toISOString(),
                date_to: time
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
        });
        const result = await response.json();
        return result as {
            customerPrice: number;
            withdraws: {
                name: string;
                amount: number;
            }[];
        };
    }, {
        body: t.Object({
            date: t.String(),
            terminal_id: t.String(),
            time: t.Optional(t.Nullable(t.String())),
        })
    })