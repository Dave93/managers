import { z } from "zod";
import puppeteer, { Page } from "puppeteer";
import { paymeReportInputSchema, yandexReportInputSchema } from "../z_objects";
import path from "path";
import { RedisClientType } from "..";
import dayjs from "dayjs";

//save cookie function
const saveCookie = async (page: Page) => {
  const cookies = await page.cookies();
  const cookieJson = JSON.stringify(cookies, null, 2);
  await Bun.write(
    path.resolve(import.meta.dir, "./cookies.ignore.json"),
    cookieJson
  );
};

//load cookie function
const loadCookie = async (page: Page) => {
  const file = Bun.file(path.resolve(import.meta.dir, "./cookies.ignore.json"));
  try {
    const cookies = await file.json();
    await page.setCookie(...cookies);
  } catch (error) { }
};

const saveLocalStorage = async (page: Page) => {
  const localStorage: any = await page.evaluate(() =>
    JSON.stringify(localStorage)
  );
  await Bun.write(
    path.resolve(import.meta.dir, "./localStorage.ignore.json"),
    localStorage
  );

  return JSON.parse(localStorage);
};

const loadLocalStorage = async (page: Page) => {
  const file = Bun.file(
    path.resolve(import.meta.dir, "./localStorage.ignore.json")
  );
  try {
    const localStorage = await file.json();
    await page.evaluate((storage) => {
      for (const key in storage) {
        // @ts-ignore
        window.localStorage.setItem(key, storage[key]);
      }
    }, localStorage);
  } catch (error) { }
};

export const getYandexReport = async (
  input: z.infer<typeof yandexReportInputSchema>,
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
  // Launch the browser and open a new blank page
  const browser = await puppeteer.launch({ headless: "new" });
  const page = await browser.newPage();

  // Navigate the page to a URL
  await page.goto("https://vendor.eda.yandex/auth");

  // Set screen size
  await page.setViewport({ width: 1920, height: 1080 });
  // await loadCookie(page);
  // await loadLocalStorage(page);

  const login =
    Bun.env[`YANDEX_${input.organization_code.toUpperCase()}_LOGIN`];
  const password =
    Bun.env[`YANDEX_${input.organization_code.toUpperCase()}_PASSWORD`];

  let authFormSelector = ".auth-content";

  await page.locator('[name="email"]').fill(login!);
  await page.locator("input[type=password]").fill(password!);

  await page.locator('[type="submit"]').click();
  let token;

  while (!token || token == "null") {
    await new Promise((r) => setTimeout(r, 100));

    let auth = await page.evaluate(async () => {
      // @ts-ignore
      return await localStorage.getItem("persist:auth");
    });

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
        place_ids: input.serviceIds.map((i) => +i),
        from: dayjs(input.date).hour(workStartTime).toISOString(),
        to: input.time
          ? dayjs(input.date)
            .hour(+input.time.split(":")[0])
            .minute(+input.time.split(":")[1])
            .second(0)
            .toISOString()
          : dayjs(input.date).add(1, "day").hour(workEndTime).toISOString(),
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
};
