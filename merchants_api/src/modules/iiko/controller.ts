import { ctx } from "@merchants/src/context";
import dayjs from "dayjs";
import { Elysia, t } from "elysia";

export const iikoController = new Elysia({
    name: '@api/iiko'
})
    .use(ctx)
    .post('/iiko', async ({
        body: {
            date, terminal_id
        }
    }) => {

        const response = await fetch(
            `https://les-ailes-co-co.iiko.it/resto/api/auth?login=${Bun.env.IIKO_LOGIN}&pass=${Bun.env.IIKO_PASS}`,
            {
                method: "GET",
            }
        );
        const token = await response.text();

        const cachierReport = await fetch(
            `https://les-ailes-co-co.iiko.it/resto/api/v2/cashshifts/list?openDateFrom=${dayjs(
                date
            ).format("YYYY-MM-DD")}&openDateTo=${dayjs(date).format(
                "YYYY-MM-DD"
            )}&groupId=${terminal_id}&status=CLOSED&key=${token}`
        );
        const reportBody = await cachierReport.json();
        let totalSum = reportBody.reduce((acc: number, item: any) => {
            return acc + item.payOrders;
        }, 0);
        return {
            cashIds: reportBody.map((item: any) => item.id),
            totalSum,
        };
    }, {
        body: t.Object({
            date: t.String(),
            terminal_id: t.String(),
        })
    })