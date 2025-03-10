import { z } from "zod";
import puppeteer, { Page } from "puppeteer";
import { paymeReportInputSchema } from "../z_objects";
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

export const getPaymeReport = async (
  input: z.infer<typeof paymeReportInputSchema>,
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
  await page.goto("https://merchant.payme.uz/auth/login?returnUrl=%2Fbusiness");

  // Set screen size
  await page.setViewport({ width: 1920, height: 1080 });
  await loadCookie(page);
  await loadLocalStorage(page);
  let authFormSelector = ".auth-content";

  await page.locator("pb-input:first-child input").fill(Bun.env.PAYME_LOGIN!);
  await page.locator("input[type=password]").fill(Bun.env.PAYME_PASSWORD!);

  await page.locator('form button[class*="primary"]').click();

  try {
    const smsForm = await page.waitForSelector("pb-sms-confirm", {
      timeout: 500,
    });
    if (smsForm) {
      await smsForm?.waitForSelector("input");
      authFormSelector = "pb-sms-confirm";
      let file = Bun.file(
        path.resolve(import.meta.dir, "./paymedata.ignore.json")
      );
      let contents = await file.json();
      let smsCode = contents.payme_sms;

      while (smsCode.length < 6) {
        await new Promise((r) => setTimeout(r, 100));
        file = Bun.file(
          path.resolve(import.meta.dir, "./paymedata.ignore.json")
        );
        contents = await file.json();
        smsCode = contents.payme_sms;
        if (smsCode.length === 6) {
          await page.locator("pb-sms-confirm input[type=text]").fill(smsCode);
          await page.locator('pb-sms-confirm button[class*="primary"]').click();
          const businessPage = await page.waitForSelector(".businesses-items");
          if (!businessPage) {
            smsCode = "";
          } else {
            authFormSelector = ".businesses-items";
          }
        }
      }
    }
    await saveCookie(page);
    await saveLocalStorage(page);
  } catch (error) {
    await saveCookie(page);
    const localStorage = await saveLocalStorage(page);

    const pbAT = JSON.parse(localStorage.__pbAT || "{}");

    if (!pbAT) {
      await browser.close();
      return 0;
    }
    const {
      auth: { token },
    } = pbAT;
    const payments = await page.evaluate(
      async (params) => {
        const result = await fetch(
          "https://merchant.payme.uz/api/receipts.find",
          {
            headers: {
              accept: "application/json, text/plain, */*",
              "accept-language": "ru",
              authentication: "Bearer " + params.token,
              "content-type": "application/json",
              "sec-ch-ua": '"Not)A;Brand";v="24", "Chromium";v="116"',
              "sec-ch-ua-mobile": "?0",
              "sec-ch-ua-platform": '"macOS"',
              "sec-fetch-dest": "empty",
              "sec-fetch-mode": "cors",
              "sec-fetch-site": "same-origin",
            },
            referrer:
              "https://merchant.payme.uz/business/5fb61b0af8caf1c00e7e4259/merchants/5fb63e71f8caf1c00e7e47ca/receipts",
            referrerPolicy: "strict-origin-when-cross-origin",
            body: JSON.stringify({
              jsonrpc: "2.0",
              method: "receipts.find",
              params: {
                filter: params.filter,
                options: { limit: 1000, skip: 0, sort: -1 },
              },
            }),
            method: "POST",
            mode: "cors",
            credentials: "include",
          }
        );
        return result.json();
      },
      {
        filter: {
          business_id: input.businessId,
          merchant_id: input.serviceIds,
          date_from: dayjs(input.date).hour(workStartTime).toISOString(),
          date_to: input.time
            ? dayjs(input.date)
              .hour(+input.time.split(":")[0])
              .minute(+input.time.split(":")[1])
              .second(0)
              .toISOString()
            : dayjs(input.date).add(1, "day").hour(workEndTime).toISOString(),
          state: [4, 104],
        },
        token,
      }
    );

    await browser.close();
    if (payments.result) {
      let totalSum = 0;
      payments.result.forEach((payment: any) => {
        totalSum += payment.amount / 100;
      });
      return totalSum;
    } else {
      return 0;
    }
  }
};
