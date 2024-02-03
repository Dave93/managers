import { ctx } from "@merchants/src/context";
import dayjs from "dayjs";
import { Elysia, t } from "elysia";
import puppeteer, { Page } from "puppeteer";

export const yandexController = new Elysia({
    name: '@api/yandex'
})
    .use(ctx)
    .post('/yandex', async ({ body: {
        date, organization_code, serviceIds, time
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
        try {
            console.log('before launching')
            const browser = await puppeteer.launch(
                { headless: 'new', args: ['--disable-web-security', '--no-sandbox'] }
            );
            const page = await browser.newPage();

            // Set a common User-Agent
            await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36');
            console.log('after launching')
            // Navigate the page to a URL
            await page.goto("https://vendor.eda.yandex/auth");
            console.log('navigate to page')
            // Set screen size
            await page.setViewport({ width: 1920, height: 1080 });
            // await loadCookie(page);
            // await loadLocalStorage(page);
            console.log('set view port');
            const login =
                Bun.env[`YANDEX_${organization_code.toUpperCase()}_LOGIN`];
            const password =
                Bun.env[`YANDEX_${organization_code.toUpperCase()}_PASSWORD`];

            let authFormSelector = ".auth-content";
            await page.type('[name="email"]', login!);
            await page.type("input[type=password]", password!);
            await page.screenshot({ path: 'yandex_login!.png' });
            // await page.locator('[name="email"]').fill(login!);
            // await page.locator("input[type=password]").fill(password!);

            console.log('form is filled');
            await page.locator('[type="submit"]').click();
            let token;

            while (!token || token == "null") {
                await new Promise((r) => setTimeout(r, 100));

                let auth = await page.evaluate(async () => {
                    // @ts-ignore
                    return await localStorage.getItem("persist:auth");
                });

                await page.screenshot({ path: 'yandex_token.png' });
                let authJson = JSON.parse(auth!);
                token = authJson.token;
            }
            const payments = await page.evaluate(
                async (params) => {
                    const orders = [];
                    const result: any = await fetch(
                        "https://vendor.eda.yandex/4.0/restapp-front/eats-restapp-orders/v1/history?limit=100",
                        {
                            headers: {
                                accept: "application/json, text/plain, */*",
                                "accept-language": "en-US,en;q=0.9",
                                "content-type": "application/json",
                                "sec-ch-ua": '"Not)A;Brand";v="24", "Chromium";v="116"',
                                "sec-ch-ua-mobile": "?0",
                                "sec-ch-ua-platform": '"macOS"',
                                "sec-fetch-dest": "empty",
                                "sec-fetch-mode": "cors",
                                "sec-fetch-site": "same-origin",
                                "x-language": "ru",
                                "x-token": params.token.replace(/"/g, ""),
                            },
                            referrer: "https://vendor.eda.yandex/microfrontends/orders-history/",
                            referrerPolicy: "strict-origin-when-cross-origin",
                            body: JSON.stringify(params.filter),
                            method: "POST",
                            mode: "cors",
                            credentials: "include",
                        }
                    );
                    try {
                        const data = await result.json();
                        if (data.summary.total.total_cnt > 100) {
                        } else {
                            return data.orders;
                        }
                    } catch (error) {
                        console.error(error);
                    }
                    return result.json();
                },
                {
                    filter: {
                        place_ids: serviceIds.map((i) => +i),
                        from: dayjs(date).hour(parseInt(workStartTime)).toISOString(),
                        to: time
                            ? dayjs(date)
                                .hour(+time.split(":")[0])
                                .minute(+time.split(":")[1])
                                .second(0)
                                .toISOString()
                            : dayjs(date).add(1, "day").hour(parseInt(workEndTime)).toISOString(),
                    },
                    token,
                }
            );

            await browser.close();
            let totalSum = 0;
            payments.forEach((payment: any) => {
                if (payment.is_reimbursement_to_place) {
                    totalSum += +payment.total_sum;
                }
            });

            return totalSum;
        } catch (error) {
            console.log('yandex puppeteer error', error)
        }
    }, {
        body: t.Object({
            date: t.String(),
            serviceIds: t.Array(t.String()),
            organization_code: t.String(),
            time: t.Optional(t.Nullable(t.String())),
        })
    })